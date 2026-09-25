let pollInterval = null;
let selectedFile = null;
let replyingToMessage = null; // Хранит { id, text, senderName }
let forwardingMessage = null; // Хранит { id, text, filename }
let allUsersCache = [];

document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    if (typeof activeRecipientId !== 'undefined' && activeRecipientId) {
        selectUser(activeRecipientId);
    }
    initEmojiPicker();
});

// Хелпер для формирования HTML аватарки
function getAvatarHtml(avatar, name) {
    if (avatar && (avatar.startsWith('uploads/') || avatar.startsWith('http') || avatar.startsWith('/'))) {
        const src = avatar.startsWith('http') || avatar.startsWith('/') ? avatar : `/static/${avatar}`;
        return `<img src="${src}" alt="Avatar">`;
    }
    return escapeHtml(avatar || (name ? name[0].toUpperCase() : '?'));
}

// --- ЗАГРУЗКА И ОТОБРАЖЕНИЕ ПОЛЬЗОВАТЕЛЕЙ ---
async function loadUsers() {
    try {
        const res = await fetch('/api/users/chats');
        if (!res.ok) return;
        allUsersCache = await res.json();
        renderUserList(allUsersCache);
    } catch (err) {
        console.error("Ошибка загрузки пользователей:", err);
    }
}
async function toggleLike(postId, btnElement) {
    const icon = btnElement.querySelector('i');
    const countSpan = btnElement.querySelector('.likes-count');
    let count = parseInt(countSpan.innerText) || 0;

    const isCurrentlyLiked = btnElement.classList.contains('liked');

    // Оптимистичное обновление интерфейса (сразу меняем иконку и счетчик)
    if (isCurrentlyLiked) {
        icon.classList.replace('fa-solid', 'fa-regular');
        btnElement.classList.remove('liked');
        countSpan.innerText = Math.max(0, count - 1);
    } else {
        icon.classList.replace('fa-regular', 'fa-solid');
        btnElement.classList.add('liked');
        countSpan.innerText = count + 1;
    }

    try {
        const res = await fetch(`/api/posts/${postId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) throw new Error('Ошибка сервера при лайке');

        const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;

        if (data) {
            // Точно синхронизируем данные с тем, что вернула база данных
            if (data.likes_count !== undefined) {
                countSpan.innerText = data.likes_count;
            }
            if (data.is_usize !== undefined || data.is_liked !== undefined) {
                const likedStatus = data.is_liked;
                if (likedStatus) {
                    btnElement.classList.add('liked');
                    icon.classList.replace('fa-regular', 'fa-solid');
                } else {
                    btnElement.classList.remove('liked');
                    icon.classList.replace('fa-solid', 'fa-regular');
                }
            }
        }
    } catch (err) {
        console.error('Ошибка при сохранении лайка в БД:', err);
        // Возвращаем как было в случае сетевой ошибки
        if (isCurrentlyLiked) {
            icon.classList.replace('fa-regular', 'fa-solid');
            btnElement.classList.add('liked');
            countSpan.innerText = count;
        } else {
            icon.classList.replace('fa-solid', 'fa-regular');
            btnElement.classList.remove('liked');
            countSpan.innerText = count;
        }
    }
}

function renderUserList(users) {
    const container = document.getElementById('userList');
    if (!container) return;
    container.innerHTML = '';

    if (!users || users.length === 0) {
        container.innerHTML = '<div style="padding:16px; text-align:center; color:#888;">Нет доступных чатов</div>';
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        const isActive = String(user.id) === String(activeRecipientId);
        item.className = `user-item ${isActive ? 'active' : ''}`;
        item.onclick = () => selectUser(user.id, user.name, user.username, user.avatar);

        item.innerHTML = `
            <div class="user-avatar-circle">${getAvatarHtml(user.avatar, user.name)}</div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(user.name)}</div>
                <div class="user-username">@${escapeHtml(user.username)}</div>
            </div>
        `;
        container.appendChild(item);
    });
}

function filterUsers() {
    const query = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
    const filtered = allUsersCache.filter(u =>
        u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query)
    );
    renderUserList(filtered);
}

// --- ВЫБОР ЧАТА ---
async function selectUser(id, name, username, avatar) {
    activeRecipientId = id;
    history.pushState(null, '', `/messages/${id}`);

    const container = document.getElementById('chatMessages');
    if (container) container.innerHTML = '';

    if (!name || avatar === undefined) {
        const res = await fetch(`/api/user/${id}`);
        if (res.ok) {
            const data = await res.json();
            name = data.name;
            username = data.username;
            avatar = data.avatar;
        }
    }

    const headerAvatar = document.getElementById('headerAvatar');
    const headerName = document.getElementById('headerName');
    const headerUsername = document.getElementById('headerUsername');
    const chatHeader = document.getElementById('chatHeader');
    const messageForm = document.getElementById('messageForm');

    if (headerAvatar) {
        headerAvatar.innerHTML = getAvatarHtml(avatar, name);
        headerAvatar.onclick = () => window.location.href = `/profile/${id}`;
        headerAvatar.style.cursor = 'pointer';
    }
    if (headerName) {
        headerName.innerText = name || 'Пользователь';
        headerName.onclick = () => window.location.href = `/profile/${id}`;
        headerName.style.cursor = 'pointer';
    }
    if (headerUsername) headerUsername.innerText = `@${username || ''}`;
    if (chatHeader) chatHeader.style.display = 'flex';
    if (messageForm) messageForm.style.display = 'flex';

    cancelReply();
    loadMessages();

    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(loadMessages, 3000);
}

// --- ЗАГРУЗКА И ОТРИСОВКА СООБЩЕНИЙ ---
async function loadMessages() {
    if (!activeRecipientId) return;

    try {
        const res = await fetch(`/api/messages/${activeRecipientId}`);
        if (!res.ok) return;
        const messages = await res.json();

        const container = document.getElementById('chatMessages');
        if (!container) return;

        if (messages.length === 0) {
            if (!container.querySelector('.empty-chat')) {
                container.innerHTML = '<div class="empty-chat">Сообщений пока нет. Напишите первым!</div>';
            }
            return;
        }

        const emptyNotice = container.querySelector('.empty-chat');
        if (emptyNotice) {
            emptyNotice.remove();
        }

        const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 60;
        let addedNewMessage = false;

        messages.forEach((msg, index) => {
            const msgUniqueKey = msg.id ? String(msg.id) : `${msg.time}-${msg.sender}-${index}`;
            let existingMsg = container.querySelector(`[data-msg-id="${msgUniqueKey}"]`);

            if (!existingMsg) {
                const msgDiv = createMessageElement(msg, msgUniqueKey);
                container.appendChild(msgDiv);
                addedNewMessage = true;
            }
        });

        if (addedNewMessage && isAtBottom) {
            container.scrollTop = container.scrollHeight;
        }
    } catch (err) {
        console.error("Ошибка загрузки сообщений:", err);
    }
}

// --- СОЗДАНИЕ ЭЛЕМЕНТА СООБЩЕНИЯ ---
function createMessageElement(msg, uniqueKey) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${msg.sender}`;
    msgDiv.setAttribute('data-msg-id', uniqueKey);

    // 1. Заголовок пересылки
    let forwardHtml = '';
    if (msg.forward_from) {
        forwardHtml = `
            <div class="msg-forward-header">
                <i class="fa-solid fa-share" style="font-size: 11px;"></i> Переслано от <b>${escapeHtml(msg.forward_from)}</b>
            </div>
        `;
    }

    // 2. Генерация Медиа
    const mediaFile = msg.filename || msg.forwarded_filename;
    let mediaHtml = '';

    if (mediaFile) {
        const lowerName = mediaFile.toLowerCase();
        const ext = lowerName.includes('.') ? lowerName.split('.').pop() : '';
        const fileUrl = `/static/uploads/${mediaFile}`;

        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
        const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', '3gp', 'weba'];

        if (imageExtensions.includes(ext)) {
            mediaHtml = `<div class="msg-media-box"><img src="${fileUrl}" alt="Изображение" onclick="window.open('${fileUrl}')"></div>`;
        }
        else if (audioExtensions.includes(ext)) {
            mediaHtml = `<div class="msg-audio-box"><audio src="${fileUrl}" controls preload="metadata"></audio></div>`;
        }
        else {
            mediaHtml = `
                <div class="msg-media-box smart-media">
                    <video src="${fileUrl}" controls preload="metadata" playsinline 
                           onloadedmetadata="if(!this.videoHeight || this.videoHeight===0){ this.style.display='none'; this.nextElementSibling.style.display='block'; }">
                    </video>
                    <audio src="${fileUrl}" controls style="display:none; width:100%;"></audio>
                </div>
            `;
        }
    }

    // 3. Блок ответа (Reply)
    let replyHtml = '';
    if (msg.reply_to_text || msg.reply_to_sender) {
        replyHtml = `
            <div class="msg-reply-quote">
                <div class="reply-quote-line"></div>
                <div class="reply-quote-body">
                    <span class="reply-author">${escapeHtml(msg.reply_to_sender || 'Сообщение')}</span>
                    <span class="reply-text-snippet">${escapeHtml(msg.reply_to_text || 'Медиафайл')}</span>
                </div>
            </div>
        `;
    }

    // 4. Кнопки действий
    const msgIdForAction = msg.id || 0;
    const senderLabel = msg.sender === 'outgoing' ? 'Вы' : 'Собеседник';
    const actionsHtml = `
        <div class="msg-actions">
            <button title="Ответить" onclick="initReply(${msgIdForAction}, '${escapeJs(msg.text || 'Медиафайл')}', '${senderLabel}')"><i class="fa-solid fa-reply"></i></button>
            <button title="Переслать" onclick="openForwardModal(${msgIdForAction}, '${escapeJs(msg.text || '')}', '${mediaFile || ''}', '${senderLabel}')"><i class="fa-solid fa-share"></i></button>
        </div>
    `;

    msgDiv.innerHTML = `
        ${actionsHtml}
        ${forwardHtml}
        ${replyHtml}
        ${mediaHtml}
        ${msg.text ? `<div class="msg-text-content">${escapeHtml(msg.text)}</div>` : ''}
        <div class="message-time-badge">${escapeHtml(msg.time || '')}</div>
    `;

    return msgDiv;
}

// --- ОТПРАВКА ОБЫЧНОГО СООБЩЕНИЯ ---
async function sendMessage(e) {
    if (e) e.preventDefault();

    const textInput = document.getElementById('messageText');
    if (!textInput) return;

    const text = textInput.value.trim();
    if (!text && !selectedFile) return;

    const formData = new FormData();
    formData.append('recipient_id', activeRecipientId);
    formData.append('text', text);

    const now = new Date();
    formData.append('time', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    if (replyingToMessage) {
        formData.append('reply_to_id', replyingToMessage.id);
    }

    if (selectedFile) {
        formData.append('file', selectedFile);
    }

    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            textInput.value = '';
            document.getElementById('fileInput').value = '';
            selectedFile = null;
            cancelReply();
            await loadMessages();

            const container = document.getElementById('chatMessages');
            if (container) container.scrollTop = container.scrollHeight;
        }
    } catch (err) {
        console.error("Ошибка отправки:", err);
    }
}

// --- ВЫБОР И ПРЕВЬЮ МЕДИА ---
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    selectedFile = file;
    const modal = document.getElementById('mediaModal');
    const container = document.getElementById('mediaPreviewContainer');
    const trimControls = document.getElementById('trimControls');

    container.innerHTML = '';
    trimControls.style.display = 'none';

    const fileURL = URL.createObjectURL(file);

    if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = fileURL;
        img.className = 'preview-media';
        container.appendChild(img);
    } else if (file.type.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = fileURL;
        audio.controls = true;
        audio.style.width = '100%';
        container.appendChild(audio);
    } else if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = fileURL;
        video.controls = true;
        video.className = 'preview-media';
        container.appendChild(video);

        video.onloadedmetadata = () => {
            document.getElementById('trimStart').value = 0;
            document.getElementById('trimEnd').value = video.duration.toFixed(1);
            document.getElementById('trimStart').max = video.duration;
            document.getElementById('trimEnd').max = video.duration;
            trimControls.style.display = 'block';
        };
    }

    modal.classList.add('active');
}

function closeMediaModal() {
    document.getElementById('mediaModal').classList.remove('active');
    document.getElementById('fileInput').value = '';
    selectedFile = null;
}

async function confirmSendMedia() {
    if (!selectedFile || !activeRecipientId) return;

    const caption = document.getElementById('mediaCaption').value.trim();
    const formData = new FormData();

    formData.append('recipient_id', activeRecipientId);
    formData.append('text', caption);
    formData.append('file', selectedFile);

    const now = new Date();
    formData.append('time', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    if (replyingToMessage) {
        formData.append('reply_to_id', replyingToMessage.id);
    }

    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            closeMediaModal();
            document.getElementById('mediaCaption').value = '';
            cancelReply();
            await loadMessages();
        }
    } catch (err) {
        console.error("Ошибка при отправке медиа:", err);
    }
}

// --- ЛОГИКА ОТВЕТА (REPLY) ---
function initReply(msgId, text, senderName) {
    replyingToMessage = { id: msgId, text: text, senderName: senderName };
    const bar = document.getElementById('replyPreviewBar');
    const title = document.getElementById('replyTitle');
    const snippet = document.getElementById('replyText');

    if (bar && title && snippet) {
        title.innerText = `Ответ пользователю ${senderName}`;
        snippet.innerText = text;
        bar.style.display = 'flex';
    }
    document.getElementById('messageText')?.focus();
}

function cancelReply() {
    replyingToMessage = null;
    const bar = document.getElementById('replyPreviewBar');
    if (bar) bar.style.display = 'none';
}

// --- ЛОГИКА ПЕРЕСЫЛКИ (FORWARD) ---
function openForwardModal(msgId, text, filename, senderName) {
    forwardingMessage = { id: msgId, text: text, filename: filename, senderName: senderName };
    const modal = document.getElementById('forwardModal');
    renderForwardUserList(allUsersCache);
    modal.classList.add('active');
}

function closeForwardModal() {
    document.getElementById('forwardModal').classList.remove('active');
    forwardingMessage = null;
}

function renderForwardUserList(users) {
    const container = document.getElementById('forwardUserList');
    if (!container) return;
    container.innerHTML = '';

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';
        item.onclick = () => confirmForwardToUser(user.id);
        item.innerHTML = `
            <div class="user-avatar-circle">${getAvatarHtml(user.avatar, user.name)}</div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(user.name)}</div>
                <div class="user-username">@${escapeHtml(user.username)}</div>
            </div>
        `;
        container.appendChild(item);
    });
}

function filterForwardUsers() {
    const q = document.getElementById('forwardSearch').value.toLowerCase();
    const filtered = allUsersCache.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
    renderForwardUserList(filtered);
}

async function confirmForwardToUser(targetUserId) {
    if (!forwardingMessage) return;

    const formData = new FormData();
    formData.append('recipient_id', targetUserId);
    formData.append('text', forwardingMessage.text || '');
    formData.append('forwarded_filename', forwardingMessage.filename || '');
    formData.append('forward_from', forwardingMessage.senderName || 'Пользователь');

    const now = new Date();
    formData.append('time', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            closeForwardModal();
            if (String(targetUserId) === String(activeRecipientId)) {
                await loadMessages();
            } else {
                selectUser(targetUserId);
            }
        }
    } catch (err) {
        console.error("Ошибка пересылки:", err);
    }
}

// --- ЭМОДЗИ ПИКЕР ---
function initEmojiPicker() {
    const emojiBtn = document.getElementById('emojiPickerBtn');
    const emojiContainer = document.getElementById('emojiPickerContainer');
    const messageInput = document.getElementById('messageText');

    if (!emojiBtn || !emojiContainer || !messageInput) return;
    if (typeof EmojiMart === 'undefined') return;

    const picker = new EmojiMart.Picker({
        locale: 'ru',
        set: 'native',
        previewPosition: 'none',
        onEmojiSelect: (emoji) => {
            const start = messageInput.selectionStart || messageInput.value.length;
            const end = messageInput.selectionEnd || messageInput.value.length;
            const text = messageInput.value;

            messageInput.value = text.substring(0, start) + emoji.native + text.substring(end);
            messageInput.focus();

            const newPos = start + emoji.native.length;
            messageInput.setSelectionRange(newPos, newPos);
        }
    });

    emojiContainer.innerHTML = '';
    emojiContainer.appendChild(picker);

    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        emojiContainer.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!emojiContainer.contains(e.target) && e.target !== emojiBtn) {
            emojiContainer.classList.remove('active');
        }
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeJs(str) {
    return String(str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}