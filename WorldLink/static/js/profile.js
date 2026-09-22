document.addEventListener('DOMContentLoaded', async () => {
    const container = document.querySelector('.profile-container');
    if (!container) return;

    const targetUserId = container.getAttribute('data-target-id');
    const userPosts = document.getElementById('userPosts');
    const postsCount = document.getElementById('postsCount');

    // Элементы профиля
    const profName = document.getElementById('profName');
    const profAge = document.getElementById('profAge');
    const profUsername = document.getElementById('profUsername');
    const profBio = document.getElementById('profBio');
    const profAvatar = document.getElementById('profAvatar');
    const followersCount = document.getElementById('followersCount');
    const followingCount = document.getElementById('followingCount');

    // Кнопки управления профилем
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

    let activeTab = 'posts';

    // -------------------------------------------------------------
    // 1. ЗАГРУЗКА ИНФОРМАЦИИ О ПРОФИЛЕ
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
            if (profAvatar) profAvatar.innerText = user.avatar || (user.name ? user.name.charAt(0) : '?');

            if (followersCount) followersCount.innerText = user.followers_count || 0;
            if (followingCount) followingCount.innerText = user.following_count || 0;

            if (user.is_self) {
                if (editBtn) editBtn.style.display = 'inline-block';
                if (subBtn) subBtn.style.display = 'none';
            } else {
                if (editBtn) editBtn.style.display = 'none';
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
    // 2. РЕДАКТИРОВАНИЕ ПРОФИЛЯ
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
    // 3. ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
    // -------------------------------------------------------------
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            activeTab = btn.getAttribute('data-tab') || 'posts';
            await loadPosts(activeTab);
        });
    });

    // -------------------------------------------------------------
    // 4. ПОДПИСКА И ОТПИСКА
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
    // 5. ЗАГРУЗКА И РЕНДЕР СЕТКИ ПОСТОВ (GRID 4xN)
    // -------------------------------------------------------------
    async function loadPosts(tab = 'posts') {
        const gridContainer = document.getElementById('postsGridContainer');
        const emptyMsg = document.getElementById('emptyFeedMsg');

        if (!gridContainer) return;
        gridContainer.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'none';

        try {
            const res = await fetch(`/api/user/${targetUserId}/posts?type=${tab}`);

            if (!res.ok) {
                if (emptyMsg) {
                    emptyMsg.innerText = 'Не удалось загрузить данные';
                    emptyMsg.style.display = 'block';
                }
                return;
            }

            const posts = await res.json();

            if (postsCount && tab === 'posts') {
                postsCount.innerText = String(posts.length);
            }

            if (!posts || posts.length === 0) {
                if (emptyMsg) {
                    emptyMsg.innerText = 'Здесь пока ничего нет';
                    emptyMsg.style.display = 'block';
                }
                return;
            }

            renderPostsGrid(posts);
        } catch (err) {
            console.error('Ошибка загрузки публикаций:', err);
            if (emptyMsg) {
                emptyMsg.innerText = 'Ошибка при загрузке';
                emptyMsg.style.display = 'block';
            }
        }
    }

    function renderPostsGrid(posts) {
        const gridContainer = document.getElementById('postsGridContainer');
        const emptyMsg = document.getElementById('emptyFeedMsg');

        if (!gridContainer) return;
        gridContainer.innerHTML = '';

        if (!posts || posts.length === 0) {
            if (emptyMsg) emptyMsg.style.display = 'block';
            return;
        }

        if (emptyMsg) emptyMsg.style.display = 'none';

        posts.forEach(post => {
            const isVideo = post.media_type === 'video';
            const mediaUrl = post.file_url || post.media_url;

            const card = document.createElement('div');
            card.className = 'profile-post-card';
            card.onclick = () => openPostModal(post.id);

            card.innerHTML = `
                ${isVideo 
                    ? `<video src="${mediaUrl}#t=0.1" preload="metadata"></video><div class="video-badge"><i class="fas fa-play"></i></div>` 
                    : `<img src="${mediaUrl}" alt="Post image">`
                }
                <div class="post-grid-overlay">
                    <span><i class="fas fa-heart"></i> ${post.likes_count || 0}</span>
                    <span><i class="fas fa-comment"></i> ${post.comments ? post.comments.length : 0}</span>
                </div>
            `;

            gridContainer.appendChild(card);
        });
    }

    // Обработчик модального окна просмотра конкретного поста
    window.openPostModal = function(postId) {
        const postModal = document.getElementById('postModal');
        if (postModal) {
            postModal.classList.add('active');
            // Здесь при необходимости можно запросить детали поста через fetch(`/api/posts/${postId}`)
        }
    };

    const closePostModalBtn = document.getElementById('closePostModal');
    if (closePostModalBtn) {
        closePostModalBtn.addEventListener('click', () => {
            const postModal = document.getElementById('postModal');
            if (postModal) postModal.classList.remove('active');
        });
    }

    // Первичная загрузка
    await loadUserProfile();
    await loadPosts(activeTab);
});