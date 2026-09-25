let activePostIdForComments = null;

document.addEventListener('DOMContentLoaded', () => {
    loadSubscriptionAvatars();
    loadSubscriptionPosts();
});

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getAvatarBgColor(name) {
    const colors = ['#0088cc', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#009688', '#4caf50', '#ff9800'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

function getAvatarHtml(avatar, name) {
    const cleanName = (name || '').trim();
    const firstLetter = cleanName ? cleanName[0].toUpperCase() : '?';

    if (avatar && avatar.trim() !== '' && !avatar.includes('undefined') && !avatar.includes('null')) {
        const src = avatar.startsWith('http') || avatar.startsWith('/') ? avatar : `/static/${avatar}`;
        return `<img src="${src}" alt="${escapeHtml(cleanName)}" class="avatar-img" onerror="this.outerHTML='<div class=\\'avatar-placeholder\\' style=\\'background-color:${getAvatarBgColor(cleanName)}\\'>${firstLetter}</div>'">`;
    }

    return `<div class="avatar-placeholder" style="background-color: ${getAvatarBgColor(cleanName)};">${firstLetter}</div>`;
}

// 1. Загрузка верхней ленты аватарок подписок
async function loadSubscriptionAvatars() {
    const rowContainer = document.getElementById('subsAvatarsRow');
    if (!rowContainer) return;

    try {
        const res = await fetch('/api/subscriptions/my');
        if (!res.ok) throw new Error('Не удалось загрузить подписки');

        const subscriptions = await res.json();
        rowContainer.innerHTML = '';

        if (subscriptions.length === 0) {
            rowContainer.innerHTML = '<div class="no-subs-hint">У вас пока нет подписок. Подпишитесь на кого-нибудь!</div>';
            return;
        }

        subscriptions.forEach(sub => {
            const avatarItem = document.createElement('a');
            avatarItem.href = `/profile/${sub.id}`;
            avatarItem.className = 'sub-avatar-item';
            avatarItem.innerHTML = `
                <div class="sub-avatar-circle">
                    ${getAvatarHtml(sub.avatar, sub.name)}
                </div>
                <span class="sub-avatar-name">${escapeHtml(sub.name)}</span>
            `;
            rowContainer.appendChild(avatarItem);
        });
    } catch (err) {
        console.error('Ошибка при загрузке аватарок подписок:', err);
        rowContainer.innerHTML = '<div class="subs-error">Не удалось загрузить подписки</div>';
    }
}

// 2. Загрузка ленты постов подписок
async function loadSubscriptionPosts() {
    const feedContainer = document.getElementById('subsFeed');
    if (!feedContainer) return;

    try {
        const res = await fetch('/api/posts/subscriptions');
        if (!res.ok) throw new Error('Не удалось загрузить публикации');

        const posts = await res.json();
        feedContainer.innerHTML = '';

        if (posts.length === 0) {
            feedContainer.innerHTML = '<div class="empty-feed">В вашей ленте подписок пока нет новых постов.</div>';
            return;
        }

        posts.forEach(post => {
            feedContainer.appendChild(createPostCard(post));
        });
    } catch (err) {
        console.error('Ошибка при загрузке постов:', err);
        feedContainer.innerHTML = '<div class="empty-feed">Ошибка при загрузке публикаций</div>';
    }
}

// Создание карточки поста
function createPostCard(post) {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.id = `post-${post.id}`;

    let mediaHtml = '';
    if (post.media_path && post.media_path.trim() !== '') {
        const mediaSrc = post.media_path.startsWith('http') || post.media_path.startsWith('/')
            ? post.media_path
            : `/static/${post.media_path}`;

        const isVideo = post.media_path.match(/\.(mp4|webm|ogg)$/i);
        if (isVideo) {
            mediaHtml = `
                <div class="post-media custom-video-container">
                    <video src="${mediaSrc}" loop playsinline id="video-${post.id}" onclick="toggleVideoPlay(${post.id})"></video>
                    <div class="custom-media-controls">
                        <button class="custom-play-btn" onclick="toggleVideoPlay(${post.id})" title="Воспроизведение/Пауза">
                            <i class="fa-solid fa-play" id="play-icon-${post.id}"></i>
                        </button>
                        <div class="volume-control-wrapper">
                            <button class="custom-mute-btn" onclick="toggleVideoMute(${post.id})" title="Звук">
                                <i class="fa-solid fa-volume-high" id="mute-icon-${post.id}"></i>
                            </button>
                            <input type="range" class="volume-slider" id="volume-${post.id}" min="0" max="1" step="0.05" value="1" oninput="changeVideoVolume(${post.id}, this.value)">
                        </div>
                    </div>
                </div>`;
        } else {
            mediaHtml = `<div class="post-media"><img src="${mediaSrc}" alt="Пост"></div>`;
        }
    }

    const isLiked = Boolean(post.is_liked);
    const likeIconClass = isLiked ? 'fa-solid' : 'fa-regular';
    const likedClass = isLiked ? 'liked' : '';

    card.innerHTML = `
        <div class="post-header">
            <a href="/profile/${post.user_id}" class="author-info">
                <div class="author-avatar">${getAvatarHtml(post.author_avatar, post.author_name)}</div>
                <div class="author-details">
                    <span class="author-name">${escapeHtml(post.author_name)}</span>
                    <span class="author-username">@${escapeHtml(post.author_username)}</span>
                </div>
            </a>
        </div>

        ${mediaHtml}

        <div class="post-actions">
            <!-- Кнопка лайка из базы данных -->
            <button class="action-btn like-btn ${likedClass}" onclick="toggleLike(${post.id}, this)">
                <i class="${likeIconClass} fa-heart"></i>
                <span class="action-count likes-count">${post.likes_count || 0}</span>
            </button>
            
            <!-- Кнопка комментариев из базы данных -->
            <button class="action-btn comment-btn" onclick="openCommentsModal(${post.id}, this)">
                <i class="fa-regular fa-comment"></i>
                <span class="action-count comments-count">${post.comments_count || 0}</span>
            </button>

            <a href="/messages/${post.user_id}" class="action-btn message-btn" title="Написать">
                <i class="fa-regular fa-paper-plane"></i>
            </a>
        </div>

        ${post.caption ? `
            <div class="post-caption">
                <a href="/profile/${post.user_id}" class="caption-author">@${escapeHtml(post.author_username)}</a>
                <span class="caption-text">${escapeHtml(post.caption)}</span>
            </div>
        ` : ''}

        <div class="post-time">${escapeHtml(post.created_at || '')}</div>

        <!-- Окно комментариев -->
        <div class="comments-drawer" onclick="event.stopPropagation()">
            <div class="comments-header">
                <h3>Комментарии (<span class="comments-header-count">0</span>)</h3>
                <button class="close-comments-btn" onclick="closeCommentsModal()">&times;</button>
            </div>
            <div class="comments-list">
                <div class="loading-spinner">Загрузка...</div>
            </div>
            <form class="comments-input-form" onsubmit="submitComment(event, ${post.id})">
                <input type="text" placeholder="Добавьте комментарий..." required autocomplete="off">
                <button type="submit" class="send-comment-btn">
                    <i class="fa-solid fa-paper-plane"></i>
                </button>
            </form>
        </div>
    `;

    return card;
}

// --- ЛАЙКИС С СЕРВЕРА/БД ---
async function toggleLike(postId, btnElement) {
    const icon = btnElement.querySelector('i');
    const countSpan = btnElement.querySelector('.likes-count');
    let count = parseInt(countSpan.innerText) || 0;

    const isCurrentlyLiked = btnElement.classList.contains('liked');

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

        if (res.ok) {
            const data = await res.json();
            if (data.likes_count !== undefined) countSpan.innerText = data.likes_count;
            if (data.is_liked !== undefined) {
                if (data.is_liked) {
                    btnElement.classList.add('liked');
                    icon.classList.replace('fa-regular', 'fa-solid');
                } else {
                    btnElement.classList.remove('liked');
                    icon.classList.replace('fa-solid', 'fa-regular');
                }
            }
        }
    } catch (err) {
        console.error('Ошибка при сохранении лайка:', err);
    }
}

// --- КОММЕНТАРИИ С СЕРВЕРА/БД ---
async function openCommentsModal(postId, btnElement) {
    closeCommentsModal();
    activePostIdForComments = postId;
    const postCard = btnElement.closest('.post-card');
    postCard.classList.add('comments-open');
    await loadComments(postId, postCard);
}

function closeCommentsModal() {
    document.querySelectorAll('.post-card.comments-open').forEach(card => {
        card.classList.remove('comments-open');
    });
    activePostIdForComments = null;
}

async function loadComments(postId, postCard) {
    const listContainer = postCard.querySelector('.comments-list');
    const countHeader = postCard.querySelector('.comments-header-count');

    try {
        const res = await fetch(`/api/posts/${postId}/comments`);
        if (!res.ok) throw new Error();
        const comments = await res.json();

        countHeader.innerText = comments.length;
        listContainer.innerHTML = '';

        if (comments.length === 0) {
            listContainer.innerHTML = '<div class="no-comments" style="text-align:center; color:#888; padding:20px 0;">Нет комментариев</div>';
            return;
        }

        comments.forEach(c => {
            const commentItem = document.createElement('div');
            commentItem.className = 'comment-item';
            commentItem.innerHTML = `
                <div class="comment-avatar">${getAvatarHtml(c.user_avatar, c.user_name)}</div>
                <div class="comment-content">
                    <div class="comment-user">@${escapeHtml(c.user_username || c.user_name)}</div>
                    <div class="comment-text">${escapeHtml(c.text)}</div>
                    <div class="comment-time">${c.created_at || ''}</div>
                </div>
            `;
            listContainer.appendChild(commentItem);
        });

        listContainer.scrollTop = listContainer.scrollHeight;
    } catch (err) {
        console.error('Ошибка загрузки комментариев:', err);
        listContainer.innerHTML = '<div class="no-comments" style="text-align:center; color:red; padding:20px 0;">Не удалось загрузить комментарии</div>';
    }
}

async function submitComment(e, postId) {
    e.preventDefault();
    const form = e.target;
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;

    const postCard = form.closest('.post-card');

    try {
        const res = await fetch(`/api/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (res.ok) {
            input.value = '';
            await loadComments(postId, postCard);
            const countSpan = postCard.querySelector('.comments-count');
            if (countSpan) countSpan.innerText = (parseInt(countSpan.innerText) || 0) + 1;
        }
    } catch (err) {
        console.error('Ошибка отправки комментария:', err);
    }
}

// Управление плеером
function toggleVideoPlay(postId) {
    const video = document.getElementById(`video-${postId}`);
    const playIcon = document.getElementById(`play-icon-${postId}`);
    if (!video) return;

    if (video.paused) {
        video.play();
        if (playIcon) playIcon.classList.replace('fa-play', 'fa-pause');
    } else {
        video.pause();
        if (playIcon) playIcon.classList.replace('fa-pause', 'fa-play');
    }
}

function toggleVideoMute(postId) {
    const video = document.getElementById(`video-${postId}`);
    const muteIcon = document.getElementById(`mute-icon-${postId}`);
    const slider = document.getElementById(`volume-${postId}`);
    if (!video) return;

    video.muted = !video.muted;
    if (muteIcon) {
        if (video.muted) {
            muteIcon.classList.replace('fa-volume-high', 'fa-volume-xmark');
            if (slider) slider.value = 0;
        } else {
            muteIcon.classList.replace('fa-volume-xmark', 'fa-volume-high');
            if (slider) slider.value = video.volume > 0 ? video.volume : 1;
        }
    }
}

function changeVideoVolume(postId, val) {
    const video = document.getElementById(`video-${postId}`);
    const muteIcon = document.getElementById(`mute-icon-${postId}`);
    if (!video) return;

    video.volume = parseFloat(val);
    video.muted = (video.volume === 0);
    if (muteIcon) {
        if (video.muted) {
            muteIcon.classList.replace('fa-volume-high', 'fa-volume-xmark');
        } else {
            muteIcon.classList.replace('fa-volume-xmark', 'fa-volume-high');
        }
    }
}

// Закрытие комментариев при клике за пределами карточки
document.addEventListener('click', (event) => {
    const activeCard = document.querySelector('.post-card.comments-open');
    if (activeCard && !activeCard.contains(event.target)) {
        closeCommentsModal();
    }
});