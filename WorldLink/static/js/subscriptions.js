document.addEventListener('DOMContentLoaded', async () => {
    const subsAvatarsRow = document.getElementById('subsAvatarsRow');
    const subsFeed = document.getElementById('subsFeed');

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    try {
        const res = await fetch('/api/subscriptions/feed');
        if (!res.ok) {
            subsFeed.innerHTML = '<div class="empty-feed">Ошибка при загрузке данных</div>';
            return;
        }

        const data = await res.json();
        const subscriptions = data.subscriptions || [];
        const posts = data.posts || [];

        // 1. Рендер верхней горизонтальной ленты подписок
        if (subscriptions.length === 0) {
            subsAvatarsRow.innerHTML = '<div class="no-subs">Вы еще ни на кого не подписаны</div>';
        } else {
            subsAvatarsRow.innerHTML = '';
            subscriptions.forEach(user => {
                const item = document.createElement('a');
                item.href = `/profile/${user.id}`;
                item.className = 'sub-avatar-item';
                item.innerHTML = `
                    <div class="sub-avatar-circle">${escapeHtml(user.avatar || '?')}</div>
                    <span class="sub-avatar-name">${escapeHtml(user.name || user.username)}</span>
                `;
                subsAvatarsRow.appendChild(item);
            });
        }

        // 2. Рендер постов подписок
        if (posts.length === 0) {
            subsFeed.innerHTML = '<div class="empty-feed">В вашей ленте подписок пока нет публикаций</div>';
            return;
        }

        subsFeed.innerHTML = '';
        posts.forEach(post => {
            const card = document.createElement('div');
            card.className = 'post-card';

            let mediaContent = '';
            if (post.media_type === 'video') {
                mediaContent = `<video src="${post.file_url}" controls class="post-media"></video>`;
            } else if (post.file_url) {
                mediaContent = `<img src="${post.file_url}" alt="Post media" class="post-media">`;
            }

            card.innerHTML = `
                <div class="post-header">
                    <a href="/profile/${post.user_id}" class="post-author-info">
                        <div class="post-author-avatar">${escapeHtml(post.avatar || '?')}</div>
                        <div class="post-author-details">
                            <span class="post-author-name">${escapeHtml(post.user_name)}</span>
                            <span class="post-author-user">@${escapeHtml(post.username)}</span>
                        </div>
                    </a>
                </div>
                ${mediaContent}
                <div class="post-details">
                    <p class="post-caption">${escapeHtml(post.caption)}</p>
                    <small class="post-date">${escapeHtml(post.created_at)}</small>
                </div>
            `;
            subsFeed.appendChild(card);
        });

    } catch (err) {
        console.error('Ошибка загрузки ленты подписок:', err);
        subsFeed.innerHTML = '<div class="empty-feed">Ошибка при соединении с сервером</div>';
    }
});