document.addEventListener('DOMContentLoaded', async () => {
    const container = document.querySelector('.profile-container');
    if (!container) return;

    const targetUserId = container.getAttribute('data-target-id');

    // Элементы профиля
    const profName = document.getElementById('profName');
    const profAge = document.getElementById('profAge');
    const profUsername = document.getElementById('profUsername');
    const profBio = document.getElementById('profBio');
    const profAvatar = document.getElementById('profAvatar');
    const avatarOverlay = document.getElementById('avatarOverlay');
    const avatarInput = document.getElementById('avatarInput');
    const followersCount = document.getElementById('followersCount');
    const followingCount = document.getElementById('followingCount');
    const userPostsGrid = document.getElementById('userPostsGrid');

    // Кнопки управления
    const editBtn = document.getElementById('editBtn');
    const editModal = document.getElementById('editModal');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const saveEditBtn = document.getElementById('saveEditBtn');
    const subBtn = document.getElementById('subBtn');

    // Поля формы редактирования
    const editName = document.getElementById('editName');
    const editUsername = document.getElementById('editUsername');
    const editAge = document.getElementById('editAge');
    const editBio = document.getElementById('editBio');

    // Модальные окна
    const listModal = document.getElementById('listModal');
    const closeListModal = document.getElementById('closeListModal');
    const listModalTitle = document.getElementById('listModalTitle');
    const usersListContainer = document.getElementById('usersListContainer');
    const followersStat = document.getElementById('followersStat');
    const followingStat = document.getElementById('followingStat');

    // Хелпер для формирования HTML аватарки
    function getAvatarHtml(avatar, name) {
        if (avatar && (avatar.startsWith('uploads/') || avatar.startsWith('http') || avatar.startsWith('/'))) {
            const src = avatar.startsWith('http') || avatar.startsWith('/') ? avatar : `/static/${avatar}`;
            return `<img src="${src}" alt="Avatar">`;
        }
        return escapeHtml(avatar || (name ? name.charAt(0).toUpperCase() : '?'));
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // -------------------------------------------------------------
    // 1. ЗАГРУЗКА ИНФОРМАЦИИ О ПРОФИЛЕ И АВАТАРКЕ
    // -------------------------------------------------------------
    async function loadUserProfile() {
        try {
            const res = await fetch(`/api/user/${targetUserId}`);
            if (!res.ok) return;

            const user = await res.json();

            if (profName) profName.innerText = user.name || 'Без имени';
            if (profAge) profAge.innerText = user.age ? `${user.age} лет` : '-- лет';
            if (profUsername) profUsername.innerText = `@${user.username || 'username'}`;
            if (profBio) profBio.innerText = user.bio || 'Описание профиля...';

            if (profAvatar) {
                profAvatar.innerHTML = getAvatarHtml(user.avatar, user.name);
            }

            if (followersCount) followersCount.innerText = user.followers_count || 0;
            if (followingCount) followingCount.innerText = user.following_count || 0;

            if (user.is_self) {
                if (editBtn) editBtn.style.display = 'inline-block';
                if (subBtn) subBtn.style.display = 'none';
                if (avatarOverlay) avatarOverlay.style.display = 'flex';
            } else {
                if (editBtn) editBtn.style.display = 'none';
                if (avatarOverlay) avatarOverlay.style.display = 'none';
                if (subBtn) {
                    subBtn.style.display = 'inline-block';
                    if (user.is_subscribed) {
                        subBtn.classList.add('subscribed');
                        subBtn.innerText = 'Отписаться';
                    } else {
                        subBtn.classList.remove('subscribed');
                        subBtn.innerText = 'Подписаться';
                    }
                }
            }
        } catch (err) {
            console.error('Ошибка при загрузке профиля:', err);
        }
    }

    // -------------------------------------------------------------
    // 2. ЗАГРУЗКА И АПДЕЙТ АВАТАРКИ
    // -------------------------------------------------------------
    if (avatarInput) {
        avatarInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('avatar', file);

            try {
                const res = await fetch('/api/user/avatar', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (res.ok && data.status === 'success') {
                    await loadUserProfile();
                } else {
                    alert(data.message || 'Ошибка при загрузке аватарки');
                }
            } catch (err) {
                console.error('Ошибка загрузки аватарки:', err);
            }
        });
    }

    // -------------------------------------------------------------
    // 3. ЗАГРУЗКА ПОСТОВ ПОЛЬЗОВАТЕЛЯ И ПЕРЕХОД К ПОСТУ
    // -------------------------------------------------------------
    async function loadUserPosts() {
        if (!userPostsGrid) return;
        userPostsGrid.innerHTML = '<div class="loading-posts">Загрузка постов...</div>';

        try {
            const res = await fetch(`/api/user/${targetUserId}/posts`);
            if (!res.ok) throw new Error();

            const posts = await res.json();
            userPostsGrid.innerHTML = '';

            if (posts.length === 0) {
                userPostsGrid.innerHTML = '<div class="no-posts">Публикаций пока нет</div>';
                return;
            }

            posts.forEach(post => {
                const postCard = document.createElement('div');
                postCard.className = 'grid-post-item';
                postCard.style.cursor = 'pointer';

                let mediaContent = '';
                if (post.media_path) {
                    const src = post.media_path.startsWith('http') || post.media_path.startsWith('/')
                        ? post.media_path
                        : `/static/${post.media_path}`;

                    if (post.media_path.match(/\.(mp4|webm|ogg)$/i)) {
                        mediaContent = `<video src="${src}" muted playsinline></video>`;
                    } else {
                        mediaContent = `<img src="${src}" alt="Post">`;
                    }
                } else {
                    mediaContent = `<div class="text-post-placeholder">${escapeHtml(post.caption || '')}</div>`;
                }

                postCard.innerHTML = `
                    ${mediaContent}
                    <div class="grid-post-overlay">
                        <span><i class="fa-solid fa-heart"></i> ${post.likes_count || 0}</span>
                        <span><i class="fa-solid fa-comment"></i> ${post.comments_count || 0}</span>
                    </div>
                `;

                // При клике на публикацию переходим на главную с меткой поста
                postCard.addEventListener('click', () => {
                    window.location.href = `/?post_id=${post.id}#post-${post.id}`;
                });

                userPostsGrid.appendChild(postCard);
            });
        } catch (err) {
            console.error('Ошибка при загрузке постов профиля:', err);
            userPostsGrid.innerHTML = '<div class="error-posts">Не удалось загрузить посты</div>';
        }
    }

    // -------------------------------------------------------------
    // 4. РЕДАКТИРОВАНИЕ ПРОФИЛЯ
    // -------------------------------------------------------------
    if (editBtn && editModal) {
        editBtn.addEventListener('click', () => {
            if (editName) editName.value = profName.innerText !== 'Загрузка...' ? profName.innerText : '';
            if (editUsername) editUsername.value = profUsername.innerText.replace('@', '');
            if (editAge) editAge.value = parseInt(profAge.innerText) || '';
            if (editBio) editBio.value = profBio.innerText !== 'Описание профиля...' ? profBio.innerText : '';

            editModal.classList.add('active');
        });
    }

    if (cancelEditBtn && editModal) {
        cancelEditBtn.addEventListener('click', () => editModal.classList.remove('active'));
    }

    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', async () => {
            const updatedData = {
                name: editName ? editName.value.trim() : '',
                username: editUsername ? editUsername.value.trim() : '',
                age: editAge ? parseInt(editAge.value) || 20 : 20,
                bio: editBio ? editBio.value.trim() : ''
            };

            try {
                const res = await fetch('/api/user/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });

                const data = await res.json();

                if (res.ok && data.status === 'success') {
                    editModal.classList.remove('active');
                    await loadUserProfile();
                } else {
                    alert(data.message || 'Не удалось сохранить данные');
                }
            } catch (err) {
                console.error('Ошибка сохранения профиля:', err);
                alert('Ошибка соединения с сервером');
            }
        });
    }

    // -------------------------------------------------------------
    // 5. ПОДПИСКА И ОТПИСКА
    // -------------------------------------------------------------
    if (subBtn) {
        subBtn.addEventListener('click', async () => {
            try {
                const res = await fetch(`/api/user/${targetUserId}/subscribe`, { method: 'POST' });
                const data = await res.json();

                if (res.ok && data.status === 'success') {
                    if (data.is_subscribed) {
                        subBtn.classList.add('subscribed');
                        subBtn.innerText = 'Отписаться';
                    } else {
                        subBtn.classList.remove('subscribed');
                        subBtn.innerText = 'Подписаться';
                    }
                    if (followersCount) followersCount.innerText = data.followers_count;
                }
            } catch (err) {
                console.error('Ошибка подписки:', err);
            }
        });
    }

    // -------------------------------------------------------------
    // 6. СПИСКИ ПОДПИСЧИКОВ / ПОДПИСОК
    // -------------------------------------------------------------
    async function openUsersList(type) {
        if (!listModal || !usersListContainer) return;

        listModalTitle.innerText = type === 'followers' ? 'Подписчики' : 'Подписки';
        usersListContainer.innerHTML = '<div class="loading-text">Загрузка...</div>';
        listModal.classList.add('active');

        try {
            const res = await fetch(`/api/user/${targetUserId}/relations/${type}`);
            if (!res.ok) throw new Error('Не удалось загрузить список');

            const users = await res.json();
            usersListContainer.innerHTML = '';

            if (users.length === 0) {
                usersListContainer.innerHTML = '<div class="empty-text">Список пуст</div>';
                return;
            }

            users.forEach(user => {
                const userItem = document.createElement('div');
                userItem.className = 'user-list-item';

                const isSelf = user.is_self;
                let actionBtnHtml = '';

                if (!isSelf) {
                    const isSub = user.is_subscribed;
                    actionBtnHtml = `
                        <button class="list-sub-btn ${isSub ? 'subscribed' : ''}" data-user-id="${user.id}">
                            ${isSub ? 'Отписаться' : 'Подписаться'}
                        </button>
                    `;
                }

                userItem.innerHTML = `
                    <div class="user-item-left" onclick="window.location.href='/profile/${user.id}'">
                        <div class="user-item-avatar">${getAvatarHtml(user.avatar, user.name)}</div>
                        <div class="user-item-info">
                            <span class="user-item-name">${escapeHtml(user.name)}</span>
                            <span class="user-item-username">@${escapeHtml(user.username)}</span>
                        </div>
                    </div>
                    <div class="user-item-right">
                        ${actionBtnHtml}
                    </div>
                `;

                const listSubBtn = userItem.querySelector('.list-sub-btn');
                if (listSubBtn) {
                    listSubBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        try {
                            const subRes = await fetch(`/api/user/${user.id}/subscribe`, { method: 'POST' });
                            const subData = await subRes.json();

                            if (subRes.ok && subData.status === 'success') {
                                if (subData.is_subscribed) {
                                    listSubBtn.classList.add('subscribed');
                                    listSubBtn.innerText = 'Отписаться';
                                } else {
                                    listSubBtn.classList.remove('subscribed');
                                    listSubBtn.innerText = 'Подписаться';
                                }
                                loadUserProfile();
                            }
                        } catch (err) {
                            console.error('Ошибка подписки из списка:', err);
                        }
                    });
                }

                usersListContainer.appendChild(userItem);
            });
        } catch (err) {
            console.error('Ошибка загрузки связей:', err);
            usersListContainer.innerHTML = '<div class="error-text">Ошибка загрузки</div>';
        }
    }

    if (followersStat) followersStat.addEventListener('click', () => openUsersList('followers'));
    if (followingStat) followingStat.addEventListener('click', () => openUsersList('following'));

    if (closeListModal && listModal) {
        closeListModal.addEventListener('click', () => listModal.classList.remove('active'));
    }

    // Загрузка данных
    await loadUserProfile();
    await loadUserPosts();
});