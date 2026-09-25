from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash
import os
import time
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

import psycopg2
import psycopg2.extras
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

import cloudinary
import cloudinary.uploader
import cloudinary.api

# --- Разрешённые расширения файлов ---
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
VIDEO_EXTENSIONS = {'mp4', 'webm'}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def allowed_file(filename, extensions=ALLOWED_EXTENSIONS):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in extensions


# --- Настройка Cloudinary (посты и аватары) ---
cloudinary.config(
    cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key=os.environ.get('CLOUDINARY_API_KEY'),
    api_secret=os.environ.get('CLOUDINARY_API_SECRET')
)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'super_secret_key_worldlink_2026')

# Папка для локальных вложений в сообщениях (посты и аватары идут в Cloudinary)
UPLOAD_FOLDER = os.path.join('static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# --- Подключение к PostgreSQL ---
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/worldlink_db')
print("DATABASE:", DATABASE_URL)


def get_db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            age INTEGER DEFAULT 20,
            bio TEXT,
            avatar TEXT NOT NULL,
            code TEXT,
            is_active INTEGER DEFAULT 0
        )
    ''')
    # На случай, если таблица уже существует в старом виде — добираем колонки
    cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS code TEXT")
    cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 0")

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            text TEXT,
            filename TEXT,
            sender TEXT NOT NULL,
            time TEXT NOT NULL,
            sender_id INTEGER,
            recipient_id INTEGER,
            forward_from TEXT
        )
    ''')
    cursor.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS forward_from TEXT")

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscriptions (
            follower_id INTEGER NOT NULL REFERENCES users(id),
            following_id INTEGER NOT NULL REFERENCES users(id),
            PRIMARY KEY (follower_id, following_id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS posts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            file_url TEXT NOT NULL,
            media_type TEXT NOT NULL,
            caption TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL REFERENCES posts(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute("ALTER TABLE comments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS likes (
            user_id INTEGER NOT NULL REFERENCES users(id),
            post_id INTEGER NOT NULL REFERENCES posts(id),
            PRIMARY KEY (user_id, post_id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS saved_posts (
            user_id INTEGER NOT NULL REFERENCES users(id),
            post_id INTEGER NOT NULL REFERENCES posts(id),
            PRIMARY KEY (user_id, post_id)
        )
    ''')

    conn.commit()
    cursor.close()
    conn.close()


init_db()


def get_current_user_id():
    return session.get('user_id')


def is_logged_in():
    return 'user_id' in session


def db_create_post(user_id, file_url, media_type, caption):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO posts (user_id, file_url, media_type, caption) VALUES (%s, %s, %s, %s) RETURNING id",
        (user_id, file_url, media_type, caption)
    )
    post_id = cursor.fetchone()['id']
    conn.commit()
    cursor.close()
    conn.close()
    return post_id


# --- ОТПРАВКА EMAIL С КОДОМ ПОДТВЕРЖДЕНИЯ ---

def send_email_code(to_email, code):
    sender_email = os.environ.get('MAIL_USERNAME')
    sender_password = os.environ.get('MAIL_PASSWORD')

    if not sender_email or not sender_password:
        print("MAIL_USERNAME / MAIL_PASSWORD не заданы в переменных окружения — письмо не отправлено")
        return False

    message = MIMEMultipart("alternative")
    message["Subject"] = "Код подтверждения для WorldLink"
    message["From"] = sender_email
    message["To"] = to_email

    text = f"Ваш 6-значный код подтверждения: {code}"
    html = f"""\
    <html>
      <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
        <div style="max-width: 500px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #333;">Подтверждение действия</h2>
          <p style="color: #555;">Ваш 6-значный код для WorldLink:</p>
          <div style="font-size: 28px; font-weight: bold; color: #0088cc; letter-spacing: 5px; margin: 20px 0; text-align: center;">
            {code}
          </div>
          <p style="color: #888; font-size: 12px;">Если вы не запрашивали этот код, просто проигнорируйте это письмо.</p>
        </div>
      </body>
    </html>
    """

    message.attach(MIMEText(text, "plain"))
    message.attach(MIMEText(html, "html"))

    try:
        server = smtplib.SMTP_SSL("smtp.gmail.com", 465)
        server.login(sender_email, sender_password)
        server.sendmail(sender_email, to_email, message.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Ошибка отправки email: {e}")
        return False


# --- АВТОРИЗАЦИЯ, РЕГИСТРАЦИЯ, СБРОС ПАРОЛЯ ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE (username = %s OR email = %s) AND is_active = 1",
            (username, username)
        )
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if user and check_password_hash(user['password_hash'], password):
            session['user_id'] = user['id']
            session['username'] = user['username']
            return redirect(url_for('index'))
        else:
            flash('Неверное имя пользователя, пароль или аккаунт не подтвержден', 'danger')

    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')

        if not username or not email or not password:
            flash('Заполните все обязательные поля', 'danger')
            return redirect(url_for('register'))

        code = str(random.randint(100000, 999999))
        password_hash = generate_password_hash(password)
        name = username
        avatar = name[0].upper()

        conn = get_db()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT id, is_active FROM users WHERE email = %s", (email,))
            existing = cursor.fetchone()

            if existing and existing['is_active'] == 1:
                flash('Пользователь с таким email уже существует', 'danger')
                return redirect(url_for('register'))

            if existing:
                cursor.execute(
                    "UPDATE users SET username = %s, password_hash = %s, code = %s, name = %s, avatar = %s "
                    "WHERE email = %s",
                    (username, password_hash, code, name, avatar, email)
                )
                user_id = existing['id']
            else:
                cursor.execute(
                    "INSERT INTO users (username, email, password_hash, name, avatar, code, is_active) "
                    "VALUES (%s, %s, %s, %s, %s, %s, 0) RETURNING id",
                    (username, email, password_hash, name, avatar, code)
                )
                user_id = cursor.fetchone()['id']

            conn.commit()

            if send_email_code(email, code):
                session['pending_user_id'] = user_id
                flash('6-значный код отправлен вам на почту!', 'info')
                return redirect(url_for('verify_email'))
            else:
                flash('Не удалось отправить письмо. Проверьте правильность email.', 'danger')

        except psycopg2.IntegrityError:
            conn.rollback()
            flash('Имя пользователя уже занято', 'danger')
        finally:
            cursor.close()
            conn.close()

    return render_template('register.html')


@app.route('/verify-email', methods=['GET', 'POST'])
def verify_email():
    if 'pending_user_id' not in session:
        return redirect(url_for('register'))

    if request.method == 'POST':
        entered_code = request.form.get('code')
        user_id = session['pending_user_id']

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT code FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()

        if user and user['code'] == entered_code:
            cursor.execute("UPDATE users SET is_active = 1, code = NULL WHERE id = %s", (user_id,))
            conn.commit()
            cursor.close()
            conn.close()

            session.pop('pending_user_id', None)
            session['user_id'] = user_id
            flash('Регистрация успешно завершена!', 'success')
            return redirect(url_for('index'))
        else:
            cursor.close()
            conn.close()
            flash('Неверный код подтверждения', 'danger')

    return render_template('verify_email.html')


@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        email = request.form.get('email')

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = %s AND is_active = 1", (email,))
        user = cursor.fetchone()

        if user:
            code = str(random.randint(100000, 999999))
            cursor.execute("UPDATE users SET code = %s WHERE id = %s", (code, user['id']))
            conn.commit()
            cursor.close()
            conn.close()

            if send_email_code(email, code):
                session['reset_user_id'] = user['id']
                flash('Код для сброса пароля отправлен на вашу почту!', 'info')
                return redirect(url_for('reset_password'))
            else:
                flash('Ошибка отправки письма', 'danger')
        else:
            cursor.close()
            conn.close()
            flash('Пользователь с таким email не найден', 'danger')

    return render_template('forgot_password.html')


@app.route('/reset-password', methods=['GET', 'POST'])
def reset_password():
    if 'reset_user_id' not in session:
        return redirect(url_for('forgot_password'))

    if request.method == 'POST':
        code = request.form.get('code')
        new_password = request.form.get('password')
        user_id = session['reset_user_id']

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT code FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()

        if user and user['code'] == code:
            new_hash = generate_password_hash(new_password)
            cursor.execute("UPDATE users SET password_hash = %s, code = NULL WHERE id = %s", (new_hash, user_id))
            conn.commit()
            cursor.close()
            conn.close()

            session.pop('reset_user_id', None)
            flash('Пароль успешно обновлен! Войдите с новым паролем.', 'success')
            return redirect(url_for('login'))
        else:
            cursor.close()
            conn.close()
            flash('Неверный код подтверждения', 'danger')

    return render_template('reset_password.html')


# --- ОСНОВНЫЕ СТРАНИЦЫ ---

@app.route('/')
def index():
    if not is_logged_in():
        return redirect(url_for('login'))
    return render_template('index.html')


@app.route('/profile')
@app.route('/profile/<int:user_id>')
def profile(user_id=None):
    if not is_logged_in():
        return redirect(url_for('login'))
    if user_id is None:
        user_id = session['user_id']
    return render_template('profile.html', target_user_id=user_id, current_user_id=session['user_id'])


@app.route('/subscriptions')
@app.route('/subscriptions/<int:user_id>')
def subscriptions_page(user_id=None):
    if not is_logged_in():
        return redirect(url_for('login'))
    if user_id is None:
        user_id = session['user_id']
    return render_template('subscriptions.html', target_user_id=user_id, current_user_id=session['user_id'])


@app.route('/messages')
@app.route('/messages/<int:user_id>')
def messages(user_id=None):
    if not is_logged_in():
        return redirect(url_for('login'))
    if user_id is None:
        user_id = session['user_id']
    return render_template('messenger.html', target_user_id=user_id, current_user_id=session['user_id'])


# --- API: ПОСТЫ, ЛАЙКИ, КОММЕНТАРИИ ---

@app.route('/api/posts/create', methods=['POST'])
def create_post():
    if not is_logged_in():
        return jsonify({'status': 'error', 'message': 'Необходима авторизация'}), 401

    current_user_id = get_current_user_id()
    caption = request.form.get('caption', '').strip()
    file = request.files.get('file')

    if not file or file.filename == '':
        return jsonify({'status': 'error', 'message': 'Пост не может быть пустым — прикрепите фото или видео'}), 400

    if not allowed_file(file.filename):
        return jsonify({'status': 'error', 'message': 'Неподдерживаемый формат файла'}), 400

    filename = secure_filename(file.filename)
    extension = filename.lower().rsplit('.', 1)[1]
    media_type = 'video' if extension in VIDEO_EXTENSIONS else 'image'

    try:
    result = cloudinary.uploader.upload(
        file,
        resource_type='video' if media_type == 'video' else 'image',
        folder='worldlink/posts'
    )

    print("CLOUDINARY RESULT:", result)

    file_url = result['secure_url']

except Exception as e:
    print("CLOUDINARY UPLOAD ERROR:", repr(e))
    return jsonify({
        'status': 'error',
        'message': 'Не удалось загрузить файл в Cloudinary',
        'error': str(e)
    }), 500

    post_id = db_create_post(current_user_id, file_url, media_type, caption)
    return jsonify({
        'status': 'success',
        'message': 'Пост успешно опубликован',
        'post_id': post_id,
        'file_url': file_url,
        'media_type': media_type
    })


@app.route('/api/posts/all', methods=['GET'])
@app.route('/api/feed', methods=['GET'])
def get_all_posts():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT posts.id, posts.file_url, posts.media_type, posts.caption, posts.created_at, posts.user_id,
               users.name, users.username, users.avatar,
               EXISTS(
                   SELECT 1 FROM subscriptions
                   WHERE follower_id = %s AND following_id = posts.user_id
               ) AS is_subscribed,
               EXISTS(
                   SELECT 1 FROM likes
                   WHERE user_id = %s AND post_id = posts.id
               ) AS is_liked,
               (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) AS likes_count,
               (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comments_count
        FROM posts
        JOIN users ON posts.user_id = users.id
        ORDER BY posts.id DESC
    ''', (current_user_id, current_user_id))

    posts = [
        {
            "id": row["id"],
            "file_url": row["file_url"],
            "media_type": row["media_type"],
            "caption": row["caption"],
            "created_at": str(row["created_at"]),
            "user_id": row["user_id"],
            "author_name": row["name"],
            "author_username": row["username"],
            "author_avatar": row["avatar"],
            "is_subscribed": bool(row["is_subscribed"]),
            "is_liked": bool(row["is_liked"]),
            "likes_count": row["likes_count"],
            "comments_count": row["comments_count"],
            "is_self": row["user_id"] == current_user_id
        } for row in cursor.fetchall()
    ]

    cursor.close()
    conn.close()
    return jsonify(posts)


@app.route('/api/posts/subscriptions', methods=['GET'])
@app.route('/api/subscriptions/feed', methods=['GET'])
def get_subscribed_posts():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT posts.id, posts.file_url, posts.media_type, posts.caption, posts.created_at, posts.user_id,
               users.name, users.username, users.avatar,
               EXISTS(
                   SELECT 1 FROM likes
                   WHERE user_id = %s AND post_id = posts.id
               ) AS is_liked,
               (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) AS likes_count,
               (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comments_count
        FROM posts
        JOIN users ON posts.user_id = users.id
        JOIN subscriptions ON subscriptions.following_id = posts.user_id
        WHERE subscriptions.follower_id = %s
        ORDER BY posts.id DESC
    ''', (current_user_id, current_user_id))

    posts = [
        {
            "id": row["id"],
            "file_url": row["file_url"],
            "media_type": row["media_type"],
            "caption": row["caption"],
            "created_at": str(row["created_at"]),
            "user_id": row["user_id"],
            "author_name": row["name"],
            "author_username": row["username"],
            "author_avatar": row["avatar"],
            "is_liked": bool(row["is_liked"]),
            "likes_count": row["likes_count"],
            "comments_count": row["comments_count"]
        } for row in cursor.fetchall()
    ]

    cursor.close()
    conn.close()
    return jsonify(posts)


@app.route('/api/posts/<int:post_id>/comments', methods=['GET'])
def get_comments(post_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT c.text, c.created_at, u.name AS user_name, u.username AS user_username, u.avatar AS user_avatar
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = %s
        ORDER BY c.id ASC
    ''', (post_id,))

    comments = [
        {
            "text": row["text"],
            "created_at": str(row["created_at"]),
            "user_name": row["user_name"],
            "user_username": row["user_username"],
            "user_avatar": row["user_avatar"]
        } for row in cursor.fetchall()
    ]

    cursor.close()
    conn.close()
    return jsonify(comments)


@app.route('/api/posts/<int:post_id>/comments', methods=['POST'])
def add_comment(post_id):
    if not is_logged_in():
        return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401

    current_user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    text = data.get('text', '').strip()

    if not text:
        return jsonify({'status': 'error', 'message': 'Текст комментария пуст'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO comments (post_id, user_id, text) VALUES (%s, %s, %s) RETURNING id, created_at",
        (post_id, current_user_id, text)
    )
    row = cursor.fetchone()
    conn.commit()

    cursor.execute("SELECT name, username, avatar FROM users WHERE id = %s", (current_user_id,))
    user = cursor.fetchone()
    cursor.close()
    conn.close()

    return jsonify({
        'status': 'success',
        'comment': {
            'id': row['id'],
            'text': text,
            'created_at': str(row['created_at']),
            'user_name': user['name'],
            'user_username': user['username'],
            'user_avatar': user['avatar']
        }
    })


@app.route('/api/posts/<int:post_id>/like', methods=['POST'])
def toggle_like(post_id):
    if not is_logged_in():
        return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT 1 FROM likes WHERE user_id = %s AND post_id = %s', (current_user_id, post_id))
    liked = cursor.fetchone()

    if liked:
        cursor.execute('DELETE FROM likes WHERE user_id = %s AND post_id = %s', (current_user_id, post_id))
        is_liked = False
    else:
        cursor.execute('INSERT INTO likes (user_id, post_id) VALUES (%s, %s)', (current_user_id, post_id))
        is_liked = True

    conn.commit()

    cursor.execute('SELECT COUNT(*) AS count FROM likes WHERE post_id = %s', (post_id,))
    likes_count = cursor.fetchone()['count']

    cursor.close()
    conn.close()

    return jsonify({'status': 'success', 'is_liked': is_liked, 'likes_count': likes_count})


@app.route('/api/posts/<int:post_id>/save', methods=['POST'])
def toggle_save(post_id):
    if not is_logged_in():
        return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT 1 FROM saved_posts WHERE user_id = %s AND post_id = %s', (current_user_id, post_id))
    is_saved = cursor.fetchone()

    if is_saved:
        cursor.execute('DELETE FROM saved_posts WHERE user_id = %s AND post_id = %s', (current_user_id, post_id))
        saved = False
    else:
        cursor.execute('INSERT INTO saved_posts (user_id, post_id) VALUES (%s, %s)', (current_user_id, post_id))
        saved = True

    conn.commit()
    cursor.close()
    conn.close()
    return jsonify({'status': 'success', 'is_saved': saved})


# --- API: СООБЩЕНИЯ ---

@app.route('/api/messages/<int:recipient_id>', methods=['GET'])
def get_messages(recipient_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT sender_id, recipient_id, text, filename, time
        FROM messages
        WHERE (sender_id = %s AND recipient_id = %s)
           OR (sender_id = %s AND recipient_id = %s)
        ORDER BY id ASC
    ''', (current_user_id, recipient_id, recipient_id, current_user_id))

    messages_list = [
        {
            "sender": "outgoing" if row["sender_id"] == current_user_id else "incoming",
            "text": row["text"],
            "filename": row["filename"],
            "time": row["time"]
        } for row in cursor.fetchall()
    ]

    cursor.close()
    conn.close()
    return jsonify(messages_list)


@app.route('/api/messages/send', methods=['POST'])
def send_message():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    recipient_id = request.form.get('recipient_id')
    text = request.form.get('text', '')
    time_str = request.form.get('time', '')
    forwarded_filename = request.form.get('forwarded_filename', '')
    forward_from = request.form.get('forward_from', '')

    if not recipient_id:
        return jsonify({"status": "error", "message": "No recipient_id provided"}), 400

    try:
        recipient_id = int(recipient_id)
    except ValueError:
        return jsonify({"status": "error", "message": "Invalid recipient_id"}), 400

    filename = ""
    file = request.files.get('file')
    if file and file.filename != '':
        base_name = secure_filename(file.filename)
        filename = f"msg_{current_user_id}_{int(time.time())}_{base_name}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

    if not filename and forwarded_filename:
        filename = forwarded_filename

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (text, filename, sender, time, sender_id, recipient_id, forward_from) "
        "VALUES (%s, %s, 'outgoing', %s, %s, %s, %s)",
        (text, filename, time_str, current_user_id, recipient_id, forward_from or None)
    )
    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"status": "success", "filename": filename})


@app.route('/api/users/chats', methods=['GET'])
def get_chat_users():
    if not is_logged_in():
        return jsonify([]), 401

    current_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT u.id, u.name, u.username, u.avatar
        FROM users u
        WHERE u.id IN (
            SELECT s1.following_id
            FROM subscriptions s1
            JOIN subscriptions s2 ON s1.following_id = s2.follower_id
            WHERE s1.follower_id = %s AND s2.following_id = %s
        )
    ''', (current_id, current_id))

    users = [dict(row) for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return jsonify(users)


# --- API: ПОЛЬЗОВАТЕЛИ И ПОДПИСКИ ---

@app.route('/api/subscriptions/my', methods=['GET'])
def get_my_subscriptions():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT users.id, users.name, users.username, users.avatar
        FROM subscriptions
        JOIN users ON subscriptions.following_id = users.id
        WHERE subscriptions.follower_id = %s
    ''', (current_user_id,))

    subs = [dict(row) for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return jsonify(subs)


@app.route('/api/user/<int:user_id>/relations/<string:rel_type>', methods=['GET'])
def get_user_relations(user_id, rel_type):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    if rel_type == 'followers':
        cursor.execute('''
            SELECT users.id, users.name, users.username, users.avatar
            FROM subscriptions
            JOIN users ON subscriptions.follower_id = users.id
            WHERE subscriptions.following_id = %s
        ''', (user_id,))
    elif rel_type == 'following':
        cursor.execute('''
            SELECT users.id, users.name, users.username, users.avatar
            FROM subscriptions
            JOIN users ON subscriptions.following_id = users.id
            WHERE subscriptions.follower_id = %s
        ''', (user_id,))
    else:
        cursor.close()
        conn.close()
        return jsonify({"error": "Invalid relation type"}), 400

    raw_users = cursor.fetchall()
    users = []

    for row in raw_users:
        target_id = row["id"]
        is_self = (target_id == current_user_id)

        is_subscribed = False
        if not is_self:
            cursor.execute('''
                SELECT 1 FROM subscriptions
                WHERE follower_id = %s AND following_id = %s
            ''', (current_user_id, target_id))
            is_subscribed = cursor.fetchone() is not None

        users.append({
            "id": row["id"],
            "name": row["name"],
            "username": row["username"],
            "avatar": row["avatar"],
            "is_self": is_self,
            "is_subscribed": is_subscribed
        })

    cursor.close()
    conn.close()
    return jsonify(users)


@app.route('/api/users/all', methods=['GET'])
def get_all_users():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, name, username, avatar FROM users WHERE id != %s AND is_active = 1",
        (current_user_id,)
    )
    users = [dict(row) for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return jsonify(users)


@app.route('/api/users/search', methods=['GET'])
def search_users():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    query = request.args.get('q', '').strip()
    if query.startswith('@'):
        query = query[1:]

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    if not query:
        cursor.execute(
            "SELECT id, name, username, avatar FROM users WHERE id != %s AND is_active = 1 LIMIT 20",
            (current_user_id,)
        )
    else:
        cursor.execute(
            "SELECT id, name, username, avatar FROM users "
            "WHERE (username ILIKE %s OR name ILIKE %s) AND id != %s AND is_active = 1 LIMIT 20",
            (f"%{query}%", f"%{query}%", current_user_id)
        )

    users = [dict(row) for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return jsonify(users)


@app.route('/api/user/<int:user_id>')
def get_user_profile(user_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()
    if not user:
        cursor.close()
        conn.close()
        return jsonify({"status": "error", "message": "User not found"}), 404

    cursor.execute("SELECT COUNT(*) AS cnt FROM subscriptions WHERE following_id = %s", (user_id,))
    followers_count = cursor.fetchone()['cnt']

    cursor.execute("SELECT COUNT(*) AS cnt FROM subscriptions WHERE follower_id = %s", (user_id,))
    following_count = cursor.fetchone()['cnt']

    cursor.execute(
        "SELECT 1 FROM subscriptions WHERE follower_id = %s AND following_id = %s",
        (current_user_id, user_id)
    )
    is_subscribed = cursor.fetchone() is not None

    cursor.close()
    conn.close()

    return jsonify({
        "id": user["id"],
        "username": user["username"],
        "name": user["name"],
        "age": user["age"] if user["age"] else 20,
        "bio": user["bio"],
        "avatar": user["avatar"],
        "followers_count": followers_count,
        "following_count": following_count,
        "is_subscribed": is_subscribed,
        "is_self": (user_id == current_user_id)
    })


@app.route('/api/user/update', methods=['POST'])
def update_profile():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    username = data.get('username')
    age = data.get('age')
    bio = data.get('bio')

    if not name or not username:
        return jsonify({"status": "error", "message": "Имя и никнейм обязательны"}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE users SET name = %s, username = %s, age = %s, bio = %s WHERE id = %s",
            (name, username, age, bio, current_user_id)
        )
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        cursor.close()
        conn.close()
        return jsonify({"status": "error", "message": "Никнейм уже занят"}), 400

    cursor.close()
    conn.close()
    return jsonify({"status": "success"})


@app.route('/api/user/<int:user_id>/subscribe', methods=['POST'])
def toggle_subscribe(user_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    if user_id == current_user_id:
        return jsonify({"status": "error", "message": "Cannot subscribe to yourself"}), 400

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT 1 FROM subscriptions WHERE follower_id = %s AND following_id = %s",
        (current_user_id, user_id)
    )
    is_subbed = cursor.fetchone()

    if is_subbed:
        cursor.execute("DELETE FROM subscriptions WHERE follower_id = %s AND following_id = %s",
                       (current_user_id, user_id))
        subscribed = False
    else:
        cursor.execute("INSERT INTO subscriptions (follower_id, following_id) VALUES (%s, %s)",
                       (current_user_id, user_id))
        subscribed = True

    conn.commit()
    cursor.execute("SELECT COUNT(*) AS cnt FROM subscriptions WHERE following_id = %s", (user_id,))
    followers_count = cursor.fetchone()['cnt']
    cursor.close()
    conn.close()

    return jsonify({"status": "success", "is_subscribed": subscribed, "followers_count": followers_count})


@app.route('/api/user/avatar', methods=['POST'])
def update_avatar():
    if not is_logged_in():
        return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401

    current_user_id = get_current_user_id()
    file = request.files.get('avatar')

    if not file or file.filename == '':
        return jsonify({'status': 'error', 'message': 'Файл не найден'}), 400

    if not allowed_file(file.filename, IMAGE_EXTENSIONS):
        return jsonify({'status': 'error', 'message': 'Неподдерживаемый формат файла'}), 400

    try:
        result = cloudinary.uploader.upload(
            file,
            resource_type='image',
            folder='worldlink/avatars'
        )
        avatar_url = result['secure_url']
    except Exception as e:
        print("Cloudinary avatar upload error:", e)
        return jsonify({'status': 'error', 'message': 'Не удалось загрузить файл'}), 500

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET avatar = %s WHERE id = %s", (avatar_url, current_user_id))
    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({'status': 'success', 'avatar': avatar_url})


@app.route('/api/user/<int:user_id>/posts', methods=['GET'])
def get_user_posts(user_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()
    tab_type = request.args.get('type', 'posts')
    conn = get_db()
    cursor = conn.cursor()

    if tab_type == 'likes':
        cursor.execute('''
            SELECT posts.id, posts.file_url, posts.media_type, posts.caption, posts.created_at,
                   (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) AS likes_count,
                   (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comments_count
            FROM likes
            JOIN posts ON likes.post_id = posts.id
            WHERE likes.user_id = %s
            ORDER BY posts.id DESC
        ''', (user_id,))
    elif tab_type == 'saved':
        cursor.execute('''
            SELECT posts.id, posts.file_url, posts.media_type, posts.caption, posts.created_at,
                   (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) AS likes_count,
                   (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comments_count
            FROM saved_posts
            JOIN posts ON saved_posts.post_id = posts.id
            WHERE saved_posts.user_id = %s
            ORDER BY posts.id DESC
        ''', (user_id,))
    else:
        cursor.execute('''
            SELECT posts.id, posts.file_url, posts.media_type, posts.caption, posts.created_at,
                   (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) AS likes_count,
                   (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comments_count
            FROM posts
            WHERE posts.user_id = %s
            ORDER BY posts.id DESC
        ''', (user_id,))

    rows = cursor.fetchall()
    posts = []
    for row in rows:
        cursor.execute("SELECT 1 FROM likes WHERE user_id = %s AND post_id = %s", (current_user_id, row["id"]))
        is_liked = cursor.fetchone() is not None
        posts.append({
            "id": row["id"],
            "file_url": row["file_url"],
            "media_type": row["media_type"],
            "caption": row["caption"],
            "created_at": str(row["created_at"]),
            "likes_count": row["likes_count"],
            "comments_count": row["comments_count"],
            "is_liked": is_liked
        })

    cursor.close()
    conn.close()
    return jsonify(posts)


if __name__ == '__main__':
    app.run(debug=True)
