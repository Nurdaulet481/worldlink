document.addEventListener('DOMContentLoaded', () => {
    let currentChatId = 1; // По умолчанию открываем первый чат
    let selectedFile = null;

    const chatsList = document.getElementById('chatsList');
    const messagesContainer = document.getElementById('messagesContainer');
    const currentChatName = document.getElementById('currentChatName');
    const currentAvatar = document.getElementById('currentAvatar');

    const chatInput = document.querySelector('.chat-input-area input[type="text"]');
    const sendBtn = document.querySelector('.send-btn');
    const attachBtn = document.querySelector('.attach-btn');
    const fileInput = document.getElementById('fileInput');
    const filePreview = document.getElementById('filePreview');
    const fileNameSpan = document.getElementById('fileName');
    const removeFileBtn = document.getElementById('removeFileBtn');

    // Проверка, является ли файл видео
    function isVideoFile(filename) {
        if (!filename) return false;
        const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov'];
        return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
    }

    // 1. Отрисовка сообщения в интерфейсе
    function renderMessage(text, filename, sender, time) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;

        let contentHTML = '';

        if (filename) {
            if (isVideoFile(filename)) {
                contentHTML += `
                    <div class="video-attachment">
                        <video controls width="100%" style="max-width: 300px; border-radius: 8px; margin-bottom: 5px;">
                            <source src="/static/uploads/${filename}" type="video/mp4">
                            Ваш браузер не поддерживает видео.
                        </video>
                    </div>
                `;
            } else {
                contentHTML += `<div class="attachment-badge"><i class="fa fa-file"></i> ${filename}</div>`;
            }
        }

        if (text) {
            contentHTML += `<div>${text}</div>`;
        }

        contentHTML += `<span class="message-time">${time}</span>`;

        msgDiv.innerHTML = `<div class="message-content">${contentHTML}</div>`;
        messagesContainer.appendChild(msgDiv);
    }

    // 2. Загрузка списка чатов из SQLite
    async function loadChats() {
        const res = await fetch('/api/chats');
        const chats = await res.json();

        chatsList.innerHTML = '';
        chats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
            chatItem.innerHTML = `
                <div class="avatar-placeholder">${chat.avatar}</div>
                <div class="chat-info">
                    <div class="chat-name">${chat.name}</div>
                </div>
            `;
            chatItem.addEventListener('click', () => switchChat(chat.id, chat.name, chat.avatar));
            chatsList.appendChild(chatItem);
        });
    }

    // 3. Переключение активного чата
    async function switchChat(chatId, name, avatar) {
        currentChatId = chatId;
        currentChatName.innerText = name;
        currentAvatar.innerText = avatar;

        loadChats();

        const res = await fetch(`/api/messages/${chatId}`);
        const messages = await res.json();

        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            renderMessage(msg.text, msg.filename, msg.sender, msg.time);
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async function sendMessage()
    {
        const text = chatInput.value.trim();

        if (!text && !selectedFile) return;

        const now = new Date();
        const timeStr = now.getHours().toString().padStart(2, '0') + ':' +
                        now.getMinutes().toString().padStart(2, '0');

        // Формируем multipart/form-data для передачи файла
        const formData = new FormData();
        formData.append('chat_id', currentChatId);
        formData.append('text', text);
        formData.append('time', timeStr);
        if (selectedFile) {
            formData.append('file', selectedFile);
        }

        // Отправляем на сервер
        const response = await fetch('/api/messages/send', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        // Отрисовываем сообщение ТОЛЬКО ПОСЛЕ успешного сохранения на сервере
        if (result.status === 'success') {
            renderMessage(text, result.filename, 'outgoing', timeStr);
        }

        // Очистка полей
        chatInput.value = '';
        selectedFile = null;
        fileInput.value = '';
        if (filePreview) filePreview.style.display = 'none';

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Обработчик выбора файла
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                selectedFile = fileInput.files[0];
                fileNameSpan.innerText = selectedFile.name;
                filePreview.style.display = 'flex';
            }
        });
    }

    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', () => {
            selectedFile = null;
            fileInput.value = '';
            filePreview.style.display = 'none';
        });
    }

    // Слушатели кнопок и Enter
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Старт при загрузке страницы
    loadChats();
    switchChat(1, 'Алексей Смирнов', 'А');
});