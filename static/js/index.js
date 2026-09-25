```javascript
let activePostIdForComments = null;
let videoObserver = null;
const controlsTimeoutMap = new Map();

// Глобальное состояние: включал ли пользователь звук хотя бы один раз
let userAudioEnabled = false;


// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initVideoObserver();
    loadFeedPosts();
});


// ============================================================
// VIDEO OBSERVER
// ============================================================

function initVideoObserver() {
    const options = {
        root: null,
        rootMargin: '0px',
        threshold: 0.6
    };

    videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            const postId = video.id.replace('video-', '');

            const playIcon = document.getElementById(`play-icon-${postId}`);
            const muteIcon = document.getElementById(`mute-icon-${postId}`);
            const slider = document.getElementById(`volume-${postId}`);

            if (entry.isIntersecting) {

                if (userAudioEnabled) {
                    video.muted = false;
                    video.volume = 1;

                    if (muteIcon) {
                        muteIcon.classList.remove('fa-volume-xmark');
                        muteIcon.classList.add('fa-volume-high');
                    }

                    if (slider) {
                        slider.value = 1;
                    }

                } else {
                    video.muted = true;

                    if (muteIcon) {
                        muteIcon.classList.remove('fa-volume-high');
                        muteIcon.classList.add('fa-volume-xmark');
                    }

                    if (slider) {
                        slider.value = 0;
                    }
                }

                video.play()
                    .then(() => {
                        if (playIcon) {
                            playIcon.classList.remove('fa-play');
                            playIcon.classList.add('fa-pause');
                        }
                    })
                    .catch((err) => {
                        console.warn(
                            `Автовоспроизведение видео ${postId} заблокировано:`,
                            err
                        );

                        video.muted = true;

                        if (muteIcon) {
                            muteIcon.classList.remove('fa-volume-high');
                            muteIcon.classList.add('fa-volume-xmark');
                        }

                        if (slider) {
                            slider.value = 0;
                        }

                        video.play().catch(() => {});
                    });

            } else {

                video.pause();

                if (playIcon) {
                    playIcon.classList.remove('fa-pause');
                    playIcon.classList.add('fa-play');
                }

                const container = video.closest('.custom-video-container');

                if (container) {
                    container.classList.remove('controls-visible');
                }
            }
        });
    }, options);
}


// ============================================================
// ЗАГРУЗКА ПОСТОВ
// ============================================================

async function loadFeedPosts() {
    const feedContainer = document.getElementById('postsFeed');

    if (!feedContainer) {
        console.error('Элемент #postsFeed не найден');
        return;
    }

    try {
        const response = await fetch('/api/posts/all');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const posts = await response.json();

        feedContainer.innerHTML = '';

        if (!posts || posts.length === 0) {
            feedContainer.innerHTML =
                '<div class="empty-feed">Пока нет ни одного поста. Опубликуйте первый!</div>';
            return;
        }

        posts.forEach(post => {
            const postCard = createPostCard(post);

            feedContainer.appendChild(postCard);

            // Регистрируем видео в Observer
            const video = postCard.querySelector('video');

            if (video && videoObserver) {
                videoObserver.observe(video);
            }
        });

        scrollToTargetPost();

    } catch (error) {
        console.error('Ошибка при загрузке постов:', error);

        feedContainer.innerHTML =
            '<div class="empty-feed">Ошибка загрузки публикаций</div>';
    }
}


// ============================================================
// ПРОКРУТКА К ПОСТУ
// ============================================================

function scrollToTargetPost() {
    const urlParams = new URLSearchParams(window.location.search);
    const postId = urlParams.get('post_id');

    if (!postId) {
        return;
    }

    setTimeout(() => {
        const targetPost = document.getElementById(`post-${postId}`);

        if (targetPost) {
            targetPost.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            targetPost.style.transition =
                'box-shadow 0.3s ease, border-color 0.3s ease';

            targetPost.style.boxShadow =
                '0 0 20px rgba(0, 136, 204, 0.5)';

            setTimeout(() => {
                targetPost.style.boxShadow = '';
            }, 2500);
        }
    }, 300);
}


// ============================================================
// СОЗДАНИЕ КАРТОЧКИ ПОСТА
// ============================================================

function createPostCard(post) {

    const card = document.createElement('div');

    card.className = 'post-card';
    card.id = `post-${post.id}`;

    card.setAttribute(
        'data-post-id',
        post.id
    );


    // --------------------------------------------------------
    // КНОПКА ПОДПИСКИ
    // --------------------------------------------------------

    let subscribeBtnHtml = '';

    if (!post.is_self) {

        const btnText = post.is_subscribed
            ? 'Подписки'
            : 'Подписаться';

        const btnClass = post.is_subscribed
            ? 'btn-subscribe subscribed'
            : 'btn-subscribe';

        subscribeBtnHtml = `
            <button
                class="${btnClass}"
                onclick="toggleSubscribe(${post.user_id}, this)"
            >
                ${btnText}
            </button>
        `;
    }


    // --------------------------------------------------------
    // МЕДИА
    // --------------------------------------------------------

    let mediaHtml = '';

    /*
        ВАЖНО:

        Backend отправляет:

        post.file_url
        post.media_type

        Поэтому НЕ используем post.media_path.
    */

    if (
        post.file_url &&
        typeof post.file_url === 'string' &&
        post.file_url.trim() !== ''
    ) {

        if (post.media_type === 'video') {

            mediaHtml = `
                <div
                    class="post-media custom-video-container"
                    id="video-container-${post.id}"
                >

                    <video
                        src="${post.file_url}"
                        loop
                        playsinline
                        preload="metadata"
                        id="video-${post.id}"
                        onclick="handleVideoClick(${post.id})"
                    ></video>


                    <div class="custom-media-controls">

                        <button
                            class="custom-play-btn"
                            onclick="toggleVideoPlay(${post.id})"
                            title="Воспроизведение/Пауза"
                        >
                            <i
                                class="fa-solid fa-play"
                                id="play-icon-${post.id}"
                            ></i>
                        </button>


                        <div class="volume-control-wrapper">

                            <button
                                class="custom-mute-btn"
                                onclick="toggleVideoMute(${post.id})"
                                title="Звук"
                            >
                                <i
                                    class="fa-solid fa-volume-xmark"
                                    id="mute-icon-${post.id}"
                                ></i>
                            </button>


                            <input
                                type="range"
                                class="volume-slider"
                                id="volume-${post.id}"
                                min="0"
                                max="1"
                                step="0.05"
                                value="0"
                                oninput="changeVideoVolume(${post.id}, this.value)"
                            >

                        </div>

                    </div>

                </div>
            `;

        } else {

            mediaHtml = `
                <div class="post-media">
                    <img
                        src="${post.file_url}"
                        alt="Пост"
                    >
                </div>
            `;
        }
    }


    // --------------------------------------------------------
    // АВАТАР
    // --------------------------------------------------------

    const avatarHtml = formatAvatarHtml(
        post.author_avatar,
        post.author_name
    );


    // --------------------------------------------------------
    // ЛАЙК
    // --------------------------------------------------------

    const isLiked = Boolean(post.is_liked);

    const likeIconClass = isLiked
        ? 'fa-solid'
        : 'fa-regular';

    const likedClass = isLiked
        ? 'liked'
        : '';


    // --------------------------------------------------------
    // HTML КАРТОЧКИ
    // --------------------------------------------------------

    card.innerHTML = `

        <div class="post-header">

            <a
                href="/profile/${post.user_id}"
                class="author-info"
                title="Перейти в профиль"
            >

                <div class="author-avatar">
                    ${avatarHtml}
                </div>


                <div class="author-details">

                    <span class="author-name">
                        ${escapeHtml(post.author_name)}
                    </span>

                    <span class="author-username">
                        @${escapeHtml(post.author_username)}
                    </span>

                </div>

            </a>


            ${subscribeBtnHtml}

        </div>


        ${mediaHtml}


        <div class="post-actions">

            <button
                class="action-btn like-btn ${likedClass}"
                onclick="toggleLike(${post.id}, this)"
            >

                <i class="${likeIconClass} fa-heart"></i>

                <span class="action-count likes-count">
                    ${post.likes_count || 0}
                </span>

            </button>


            <button
                class="action-btn comment-btn"
                onclick="openCommentsModal(${post.id}, this)"
            >

                <i class="fa-regular fa-comment"></i>

                <span class="action-count comments-count">
                    ${post.comments_count || 0}
                </span>

            </button>


            ${!post.is_self ? `

                <a
                    href="/messages/${post.user_id}"
                    class="action-btn message-btn"
                    title="Написать автору"
                >

                    <i class="fa-regular fa-paper-plane"></i>

                </a>

            ` : ''}

        </div>


        ${post.caption ? `

            <div class="post-caption">

                <a
                    href="/profile/${post.user_id}"
                    class="caption-author"
                >
                    @${escapeHtml(post.author_username)}
                </a>

                <span class="caption-text">
                    ${escapeHtml(post.caption)}
                </span>

            </div>

        ` : ''}


        <div class="post-time">
            ${post.created_at || ''}
        </div>


        <div
            class="comments-drawer"
            onclick="event.stopPropagation()"
        >

            <div class="comments-header">

                <h3>
                    Комментарии
                    (<span class="comments-header-count">0</span>)
                </h3>


                <button
                    class="close-comments-btn"
                    onclick="closeCommentsModal()"
                >
                    &times;
                </button>

            </div>


            <div class="comments-list">

                <div class="loading-spinner">
                    Загрузка...
                </div>

            </div>


            <form
                class="comments-input-form"
                onsubmit="submitComment(event, ${post.id})"
            >

                <input
                    type="text"
                    placeholder="Добавьте комментарий..."
                    required
                    autocomplete="off"
                >


                <button
                    type="submit"
                    class="send-comment-btn"
                >

                    <i class="fa-solid fa-paper-plane"></i>

                </button>

            </form>

        </div>
    `;


    return card;
}


// ============================================================
// КЛИК ПО ВИДЕО
// ============================================================

function handleVideoClick(postId) {

    const video = document.getElementById(
        `video-${postId}`
    );

    const muteIcon = document.getElementById(
        `mute-icon-${postId}`
    );

    const slider = document.getElementById(
        `volume-${postId}`
    );


    if (!video) {
        return;
    }


    // Включаем звук при первом клике

    if (video.muted || !userAudioEnabled) {

        userAudioEnabled = true;

        video.muted = false;
        video.volume = 1;


        if (muteIcon) {
            muteIcon.classList.remove(
                'fa-volume-xmark'
            );

            muteIcon.classList.add(
                'fa-volume-high'
            );
        }


        if (slider) {
            slider.value = 1;
        }

    } else {

        toggleVideoPlay(postId);
    }


    showControlsTemporarily(postId);
}


// ============================================================
// ПОКАЗ КОНТРОЛОВ
// ============================================================

function showControlsTemporarily(postId) {

    const container = document.getElementById(
        `video-container-${postId}`
    );

    if (!container) {
        return;
    }


    container.classList.add(
        'controls-visible'
    );


    if (controlsTimeoutMap.has(postId)) {

        clearTimeout(
            controlsTimeoutMap.get(postId)
        );
    }


    const timeout = setTimeout(() => {

        container.classList.remove(
            'controls-visible'
        );

        controlsTimeoutMap.delete(postId);

    }, 3000);


    controlsTimeoutMap.set(
        postId,
        timeout
    );
}


// ============================================================
// PLAY / PAUSE
// ============================================================

function toggleVideoPlay(postId) {

    const video = document.getElementById(
        `video-${postId}`
    );

    const playIcon = document.getElementById(
        `play-icon-${postId}`
    );


    if (!video) {
        return;
    }


    if (video.paused) {

        video.play()
            .then(() => {

                if (playIcon) {

                    playIcon.classList.remove(
                        'fa-play'
                    );

                    playIcon.classList.add(
                        'fa-pause'
                    );
                }

            })
            .catch(error => {
                console.error(
                    'Ошибка воспроизведения:',
                    error
                );
            });

    } else {

        video.pause();


        if (playIcon) {

            playIcon.classList.remove(
                'fa-pause'
            );

            playIcon.classList.add(
                'fa-play'
            );
        }
    }


    showControlsTemporarily(postId);
}


// ============================================================
// MUTE / UNMUTE
// ============================================================

function toggleVideoMute(postId) {

    const video = document.getElementById(
        `video-${postId}`
    );

    const muteIcon = document.getElementById(
        `mute-icon-${postId}`
    );

    const slider = document.getElementById(
        `volume-${postId}`
    );


    if (!video) {
        return;
    }


    video.muted = !video.muted;


    userAudioEnabled = !video.muted;


    if (video.muted) {

        if (muteIcon) {

            muteIcon.classList.remove(
                'fa-volume-high'
            );

            muteIcon.classList.add(
                'fa-volume-xmark'
            );
        }


        if (slider) {
            slider.value = 0;
        }

    } else {

        if (video.volume === 0) {
            video.volume = 1;
        }


        if (muteIcon) {

            muteIcon.classList.remove(
                'fa-volume-xmark'
            );

            muteIcon.classList.add(
                'fa-volume-high'
            );
        }


        if (slider) {
            slider.value = video.volume;
        }
    }


    showControlsTemporarily(postId);
}


// ============================================================
// ГРОМКОСТЬ
// ============================================================

function changeVideoVolume(postId, val) {

    const video = document.getElementById(
        `video-${postId}`
    );

    const muteIcon = document.getElementById(
        `mute-icon-${postId}`
    );


    if (!video) {
        return;
    }


    video.volume = parseFloat(val);

    video.muted = video.volume === 0;

    userAudioEnabled = !video.muted;


    if (muteIcon) {

        if (video.muted) {

            muteIcon.classList.remove(
                'fa-volume-high'
            );

            muteIcon.classList.add(
                'fa-volume-xmark'
            );

        } else {

            muteIcon.classList.remove(
                'fa-volume-xmark'
            );

            muteIcon.classList.add(
                'fa-volume-high'
            );
        }
    }


    showControlsTemporarily(postId);
}


// ============================================================
// ЦВЕТ АВАТАРА
// ============================================================

function getAvatarBgColor(name) {

    const colors = [
        '#0088cc',
        '#e91e63',
        '#9c27b0',
        '#673ab7',
        '#3f51b5',
        '#009688',
        '#4caf50',
        '#ff9800'
    ];


    let hash = 0;


    for (let i = 0; i < name.length; i++) {

        hash =
            name.charCodeAt(i) +
            ((hash << 5) - hash);
    }


    const index =
        Math.abs(hash) % colors.length;


    return colors[index];
}


// ============================================================
// АВАТАР
// ============================================================

function formatAvatarHtml(avatarPath, name) {

    const cleanName =
        (name || '').trim();


    const firstLetter =
        cleanName
            ? cleanName[0].toUpperCase()
            : '?';


    if (
        avatarPath &&
        avatarPath.trim() !== '' &&
        !avatarPath.includes('undefined') &&
        !avatarPath.includes('null')
    ) {

        const src =
            avatarPath.startsWith('http') ||
            avatarPath.startsWith('/')
                ? avatarPath
                : `/static/${avatarPath}`;


        return `
            <img
                src="${src}"
                alt="${escapeHtml(cleanName)}"
                class="avatar-img"
                onerror="this.outerHTML='<div class=\\'avatar-placeholder\\' style=\\'background-color:${getAvatarBgColor(cleanName)}\\'>${firstLetter}</div>'"
            >
        `;
    }


    const bgColor =
        getAvatarBgColor(cleanName);


    return `
        <div
            class="avatar-placeholder"
            style="background-color: ${bgColor};"
        >
            ${firstLetter}
        </div>
    `;
}


// ============================================================
// ЛАЙКИ
// ============================================================

async function toggleLike(postId, btnElement) {

    const icon =
        btnElement.querySelector('i');


    const countSpan =
        btnElement.querySelector('.likes-count');


    let count =
        parseInt(countSpan.innerText) || 0;


    const isCurrentlyLiked =
        btnElement.classList.contains('liked');


    if (isCurrentlyLiked) {

        icon.classList.remove(
            'fa-solid'
        );

        icon.classList.add(
            'fa-regular'
        );

        btnElement.classList.remove(
            'liked'
        );

        countSpan.innerText =
            Math.max(0, count - 1);

    } else {

        icon.classList.remove(
            'fa-regular'
        );

        icon.classList.add(
            'fa-solid'
        );

        btnElement.classList.add(
            'liked'
        );

        countSpan.innerText =
            count + 1;
    }


    try {

        const res =
            await fetch(
                `/api/posts/${postId}/like`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type':
                            'application/json'
                    }
                }
            );


        if (res.ok) {

            const data =
                await res.json();


            if (
                data.likes_count !== undefined
            ) {

                countSpan.innerText =
                    data.likes_count;
            }


            if (
                data.is_liked !== undefined
            ) {

                if (data.is_liked) {

                    btnElement.classList.add(
                        'liked'
                    );

                    icon.classList.replace(
                        'fa-regular',
                        'fa-solid'
                    );

                } else {

                    btnElement.classList.remove(
                        'liked'
                    );

                    icon.classList.replace(
                        'fa-solid',
                        'fa-regular'
                    );
                }
            }
        }

    } catch (err) {

        console.error(
            'Ошибка при сохранении лайка:',
            err
        );
    }
}


// ============================================================
// КОММЕНТАРИИ
// ============================================================

async function openCommentsModal(
    postId,
    btnElement
) {

    closeCommentsModal();


    activePostIdForComments =
        postId;


    const postCard =
        btnElement.closest(
            '.post-card'
        );


    const overlay =
        document.getElementById(
            'commentsOverlay'
        );


    if (postCard) {
        postCard.classList.add(
            'comments-open'
        );
    }


    if (overlay) {
        overlay.classList.add(
            'active'
        );
    }


    if (postCard) {
        await loadComments(
            postId,
            postCard
        );
    }
}


function closeCommentsModal() {

    document
        .querySelectorAll(
            '.post-card.comments-open'
        )
        .forEach(card => {

            card.classList.remove(
                'comments-open'
            );
        });


    const overlay =
        document.getElementById(
            'commentsOverlay'
        );


    if (overlay) {
        overlay.classList.remove(
            'active'
        );
    }


    activePostIdForComments =
        null;
}


// ============================================================
// ЗАГРУЗКА КОММЕНТАРИЕВ
// ============================================================

async function loadComments(
    postId,
    postCard
) {

    const listContainer =
        postCard.querySelector(
            '.comments-list'
        );


    const countHeader =
        postCard.querySelector(
            '.comments-header-count'
        );


    try {

        const res =
            await fetch(
                `/api/posts/${postId}/comments`
            );


        if (!res.ok) {
            throw new Error(
                `HTTP ${res.status}`
            );
        }


        const comments =
            await res.json();


        if (countHeader) {
            countHeader.innerText =
                comments.length;
        }


        listContainer.innerHTML =
            '';


        if (comments.length === 0) {

            listContainer.innerHTML = `
                <div
                    class="no-comments"
                    style="
                        text-align:center;
                        color:#888;
                        padding:20px 0;
                    "
                >
                    Нет комментариев
                </div>
            `;

            return;
        }


        comments.forEach(c => {

            const commentItem =
                document.createElement(
                    'div'
                );


            commentItem.className =
                'comment-item';


            const avatarHtml =
                formatAvatarHtml(
                    c.user_avatar,
                    c.user_name
                );


            commentItem.innerHTML = `

                <div class="comment-avatar">
                    ${avatarHtml}
                </div>

                <div class="comment-content">

                    <div class="comment-user">
                        @${escapeHtml(
                            c.user_username ||
                            c.user_name
                        )}
                    </div>

                    <div class="comment-text">
                        ${escapeHtml(c.text)}
                    </div>

                    <div class="comment-time">
                        ${c.created_at || ''}
                    </div>

                </div>

            `;


            listContainer.appendChild(
                commentItem
            );
        });


        listContainer.scrollTop =
            listContainer.scrollHeight;


    } catch (err) {

        console.error(
            'Ошибка загрузки комментариев:',
            err
        );


        listContainer.innerHTML = `
            <div
                class="no-comments"
                style="
                    text-align:center;
                    color:red;
                    padding:20px 0;
                "
            >
                Не удалось загрузить комментарии
            </div>
        `;
    }
}


// ============================================================
// ОТПРАВКА КОММЕНТАРИЯ
// ============================================================

async function submitComment(
    e,
    postId
) {

    e.preventDefault();


    const form =
        e.target;


    const input =
        form.querySelector('input');


    const text =
        input.value.trim();


    if (!text) {
        return;
    }


    const postCard =
        form.closest(
            '.post-card'
        );


    try {

        const res =
            await fetch(
                `/api/posts/${postId}/comments`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type':
                            'application/json'
                    },
                    body: JSON.stringify({
                        text: text
                    })
                }
            );


        if (res.ok) {

            input.value = '';


            await loadComments(
                postId,
                postCard
            );


            const countSpan =
                postCard.querySelector(
                    '.comments-count'
                );


            if (countSpan) {

                countSpan.innerText =
                    (
                        parseInt(
                            countSpan.innerText
                        ) || 0
                    ) + 1;
            }
        }

    } catch (err) {

        console.error(
            'Ошибка отправки комментария:',
            err
        );
    }
}


// ============================================================
// ПОДПИСКИ
// ============================================================

async function toggleSubscribe(
    userId,
    buttonElement
) {

    try {

        const response =
            await fetch(
                `/api/user/${userId}/subscribe`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type':
                            'application/json'
                    }
                }
            );


        const result =
            await response.json();


        if (result.status === 'success') {

            if (result.is_subscribed) {

                buttonElement.innerText =
                    'Подписки';

                buttonElement.classList.add(
                    'subscribed'
                );

            } else {

                buttonElement.innerText =
                    'Подписаться';

                buttonElement.classList.remove(
                    'subscribed'
                );
            }
        }

    } catch (error) {

        console.error(
            'Ошибка подписки:',
            error
        );
    }
}


// ============================================================
// ЗАКРЫТИЕ КОММЕНТАРИЕВ ПРИ КЛИКЕ СНАРУЖИ
// ============================================================

document.addEventListener(
    'click',
    (event) => {

        const activeCard =
            document.querySelector(
                '.post-card.comments-open'
            );


        if (
            activeCard &&
            !activeCard.contains(event.target)
        ) {

            closeCommentsModal();
        }
    }
);


// ============================================================
// ЭКРАНИРОВАНИЕ HTML
// ============================================================

function escapeHtml(str) {

    return String(str || '')
        .replace(
            /&/g,
            '&amp;'
        )
        .replace(
            /</g,
            '&lt;'
        )
        .replace(
            />/g,
            '&gt;'
        )
        .replace(
            /"/g,
            '&quot;'
        );
}
```

После замены файла **перезагрузи страницу с очисткой кэша**: `Ctrl + Shift + R`.

Теперь пост с твоей записью из БД:

```text
file_url   = https://res.cloudinary.com/.../video/upload/...mp4
media_type = video
```

будет превращаться именно в:

```html
<video src="https://res.cloudinary.com/.../video/upload/...mp4">
```

а PNG — в `<img>`.

И ещё важный момент: **новые видео загружать в Cloudinary заново не нужно**. Твои посты `8` и `9` уже там есть. После исправления JS они должны подтянуться из PostgreSQL и отобразиться.
