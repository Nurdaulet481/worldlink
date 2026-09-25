from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash
import os
import psycopg2
import psycopg2.extras
from datetime import datetime
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import cloudinary
import cloudinary.uploader
import cloudinary.api

# Настройка Cloudinary
cloudinary.config(
    cloud_name = os.environ.get('Root'),
    api_key = os.environ.get('977269796916619'),
    api_secret = os.environ.get('olw2XQiQExGDgc1p4Rs1U1ZLWMY')
)

app = Flask(__name__)
# Секретный ключ нужен для работы сессий Flask
app.secret_key = os.environ.get('SECRET_KEY', 'super_secret_key_worldlink_2026')

UPLOAD_FOLDER = os.path.join('static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Подключение к PostgreSQL
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/worldlink_db')

print("DATABASE:", DATABASE_URL)


def get_db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Таблица пользователей
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            age INTEGER DEFAULT 20,
            bio TEXT,
            avatar TEXT NOT NULL
        )
    ''')

    # Таблица чатов
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chats (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            avatar TEXT NOT NULL
        )
    ''')

    # Таблица сообщений
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            chat_id INTEGER,
            text TEXT,
            filename TEXT,
            sender TEXT NOT NULL,
            time TEXT NOT NULL,
            sender_id INTEGER,
            recipient_id INTEGER
        )
    ''')

    # Таблица подписок
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscriptions (
            follower_id INTEGER NOT NULL REFERENCES users(id),
            following_id INTEGER NOT NULL REFERENCES users(id),
            PRIMARY KEY (follower_id, following_id)
        )
    ''')

    # Таблица постов
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

    # Таблица лайков
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS likes (
            user_id INTEGER NOT NULL REFERENCES users(id),
            post_id INTEGER NOT NULL REFERENCES posts(id),
            PRIMARY KEY (user_id, post_id)
        )
    ''')

    # Таблица комментариев
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL REFERENCES posts(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            text TEXT NOT NULL
        )
    ''')

    # Таблица закладок
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


# Вспомогательные функции авторизации
def get_current_user_id():
    return session.get('user_id')

def is_logged_in():
    return 'user_id' in session


# --- АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users WHERE username = %s OR email = %s",
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
            flash('Неверное имя пользователя или пароль', 'danger')

    return render_template('login.html')


@app.route('/api/users/search', methods=['GET'])
def search_users():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    query = request.args.get('q', '').strip()
    current_user_id = get_current_user_id()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, name, username, avatar FROM users WHERE (username ILIKE %s OR name ILIKE %s) AND id != %s LIMIT 10",
        (f"%{query}%", f"%{query}%", current_user_id)
    )
    users = [{"id": row["id"], "name": row["name"], "username": row["username"], "avatar": row["avatar"]} for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return jsonify(users)


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')

        if not username or not name or not email or not password:
            flash('Заполните все поля', 'danger')
            return redirect(url_for('register'))

        password_hash = generate_password_hash(password)
        avatar = name[0].upper()

        conn = get_db()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s OR email = %s",
                (username, email)
            )

            if cursor.fetchone():
                flash('Пользователь с таким именем или email уже существует', 'danger')
                return redirect(url_for('register'))

            cursor.execute(
                """
                INSERT INTO users
                (username, email, password_hash, name, avatar)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (username, email, password_hash, name, avatar)
            )

            conn.commit()
            flash('Регистрация прошла успешно! Теперь войдите.', 'success')
            return redirect(url_for('login'))

        except Exception as e:
            conn.rollback()
            print(f"Registration error: {e}")
            flash('Ошибка при регистрации', 'danger')

        finally:
            cursor.close()
            conn.close()

    return render_template('register.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# --- ОСНОВНЫЕ СТРАНИЦЫ (ЗАЩИЩЕННЫЕ) ---

@app.route('/')
def index():
    if not is_logged_in():
        return redirect(url_for('login'))
    posts = fetch_global_posts()
    return render_template('index.html', posts=posts)


@app.route('/messages')
def messages():
    if not is_logged_in():
        return redirect(url_for('login'))
    return render_template('messenger.html')


@app.route('/profile')
@app.route('/profile/')
def profile(user_id=None):
    if not is_logged_in():
        return redirect(url_for('login'))
    if user_id is None:
        user_id = session['user_id']
    return render_template('profile.html', target_user_id=user_id, current_user_id=session['user_id'])


@app.route('/subscriptions')
def subscriptions_page():
    if not is_logged_in():
        return redirect(url_for('login'))
    return render_template('subscriptions.html')


def fetch_global_posts():
    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT p.*, u.username, u.avatar, u.name as user_name 
        FROM posts p 
        JOIN users u ON p.user_id = u.id 
        ORDER BY p.id DESC
    ''')
    rows = cursor.fetchall()
    posts = []

    for row in rows:
        post_id = row['id']

        cursor.execute("SELECT COUNT(*) as cnt FROM likes WHERE post_id = %s", (post_id,))
        likes_count = cursor.fetchone()['cnt']

        cursor.execute("SELECT 1 FROM likes WHERE user_id = %s AND post_id = %s", (current_user_id, post_id))
        is_liked = cursor.fetchone() is not None

        cursor.execute(
            "SELECT c.text, u.name, u.username FROM comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = %s",
            (post_id,)
        )
        comments_rows = cursor.fetchall()
        comments = [{"name": c["name"], "username": c["username"], "text": c["text"]} for c in comments_rows]

        created_at_val = row["created_at"]
        if isinstance(created_at_val, str):
            try:
                created_at_val = datetime.strptime(created_at_val, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                created_at_val = datetime.now()

        posts.append({
            "id": post_id,
            "user_id": row["user_id"],
            "media_url": row["file_url"],
            "file_url": row["file_url"],
            "media_type": row["media_type"],
            "caption": row["caption"],
            "created_at": created_at_val,
            "author": {
                "username": row["username"],
                "avatar": row["avatar"] if row["avatar"].startswith('/') or row["avatar"].startswith('http') else None
            },
            "user_name": row["user_name"],
            "username": row["username"],
            "avatar": row["avatar"],
            "likes_count": likes_count,
            "is_liked": is_liked,
            "comments": comments
        })

    cursor.close()
    conn.close()
    return posts


# --- API МАРШРУТЫ ---

@app.route('/api/feed', methods=['GET'])
def get_global_feed():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    posts = fetch_global_posts()
    for p in posts:
        if isinstance(p["created_at"], datetime):
            p["created_at"] = p["created_at"].strftime('%Y-%m-%d %H:%M:%S')
    return jsonify(posts)


@app.route('/api/subscriptions/feed', methods=['GET'])
def get_subscriptions_feed():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT u.id, u.name, u.username, u.avatar 
        FROM subscriptions s
        JOIN users u ON s.following_id = u.id
        WHERE s.follower_id = %s
    ''', (current_user_id,))

    subscribed_users = [
        {"id": row["id"], "name": row["name"], "username": row["username"], "avatar": row["avatar"]}
        for row in cursor.fetchall()
    ]

    cursor.execute('''
        SELECT p.*, u.name as user_name, u.username, u.avatar 
        FROM posts p 
        JOIN users u ON p.user_id = u.id 
        JOIN subscriptions s ON p.user_id = s.following_id
        WHERE s.follower_id = %s 
        ORDER BY p.id DESC
    ''', (current_user_id,))

    rows = cursor.fetchall()
    posts = []

    for row in rows:
        post_id = row['id']
        cursor.execute("SELECT COUNT(*) as cnt FROM likes WHERE post_id = %s", (post_id,))
        likes_count = cursor.fetchone()['cnt']

        cursor.execute("SELECT 1 FROM likes WHERE user_id = %s AND post_id = %s", (current_user_id, post_id))
        is_liked = cursor.fetchone() is not None

        cursor.execute("SELECT c.text, u.name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = %s", (post_id,))
        comments = [{"name": c["name"], "text": c["text"]} for c in cursor.fetchall()]

        posts.append({
            "id": post_id,
            "user_id": row["user_id"],
            "file_url": row["file_url"],
            "media_type": row["media_type"],
            "caption": row["caption"],
            "created_at": str(row["created_at"]),
            "user_name": row["user_name"],
            "username": row["username"],
            "avatar": row["avatar"],
            "likes_count": likes_count,
            "is_liked": is_liked,
            "comments": comments
        })

    cursor.close()
    conn.close()

    return jsonify({
        "subscriptions": subscribed_users,
        "posts": posts
    })


@app.route('/api/chats', methods=['GET'])
def get_chats():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify([])


@app.route('/api/messages/', methods=['GET'])
def get_messages(recipient_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT text, filename, sender, time, sender_id 
        FROM messages 
        WHERE (sender_id = %s AND recipient_id = %s) OR (sender_id = %s AND recipient_id = %s)
        ORDER BY id ASC
    ''', (current_user_id, recipient_id, recipient_id, current_user_id))
    
    messages = []
    for row in cursor.fetchall():
        sender_type = 'outgoing' if row["sender_id"] == current_user_id else 'incoming'
        messages.append({
            "text": row["text"],
            "filename": row["filename"],
            "sender": sender_type,
            "time": row["time"]
        })
        
    cursor.close()
    conn.close()
    return jsonify(messages)


@app.route('/api/messages/send', methods=['POST'])
def send_message():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    current_user_id = get_current_user_id()
    
    filename = ""
    recipient_id = request.form.get('recipient_id')
    text = request.form.get('text', '')
    time_str = request.form.get('time', '')
    
    if request.files and 'file' in request.files:
        file = request.files['file']
        if file and file.filename != '':
            filename = secure_filename(file.filename)
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

    if not recipient_id:
        return jsonify({"status": "error", "message": "No recipient_id provided"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (text, filename, sender, time, sender_id, recipient_id) VALUES (%s, %s, 'outgoing', %s, %s, %s)",
        (text, filename, time_str, current_user_id, recipient_id)
    )
    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"status": "success", "filename": filename})


@app.route('/api/user/')
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

    cursor.execute("SELECT COUNT(*) as cnt FROM subscriptions WHERE following_id = %s", (user_id,))
    followers_count = cursor.fetchone()['cnt']

    cursor.execute("SELECT COUNT(*) as cnt FROM subscriptions WHERE follower_id = %s", (user_id,))
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
    data = request.json or {}
    name = data.get('name')
    username = data.get('username')
    age = data.get('age')
    bio = data.get('bio')

    if not name or not username:
        return jsonify({"status": "error", "message": "Имя и никнейм обязательны"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET name = %s, username = %s, age = %s, bio = %s WHERE id = %s",
        (name, username, age, bio, current_user_id)
    )
    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"status": "success"})


@app.route('/api/user//subscribe', methods=['POST'])
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
        cursor.execute("DELETE FROM subscriptions WHERE follower_id = %s AND following_id = %s", (current_user_id, user_id))
        subscribed = False
    else:
        cursor.execute("INSERT INTO subscriptions (follower_id, following_id) VALUES (%s, %s)", (current_user_id, user_id))
        subscribed = True

    conn.commit()
    cursor.execute("SELECT COUNT(*) as cnt FROM subscriptions WHERE following_id = %s", (user_id,))
    followers_count = cursor.fetchone()['cnt']
    cursor.close()
    conn.close()

    return jsonify({"status": "success", "is_subscribed": subscribed, "followers_count": followers_count})


@app.route('/api/user//relations/')
def get_relations(user_id, rel_type):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    conn = get_db()
    cursor = conn.cursor()

    if rel_type == 'followers':
        query = "SELECT u.id, u.name, u.username, u.avatar FROM subscriptions s JOIN users u ON s.follower_id = u.id WHERE s.following_id = %s"
    else:
        query = "SELECT u.id, u.name, u.username, u.avatar FROM subscriptions s JOIN users u ON s.following_id = u.id WHERE s.follower_id = %s"

    cursor.execute(query, (user_id,))
    users = [{"id": row["id"], "name": row["name"], "username": row["username"], "avatar": row["avatar"]} for row in cursor.fetchall()]
    cursor.close()
    conn.close()

    return jsonify(users)


@app.route('/api/user//posts')
def get_user_posts(user_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    current_user_id = get_current_user_id()
    tab_type = request.args.get('type', 'posts')
    conn = get_db()
    cursor = conn.cursor()

    if tab_type == 'likes':
        query = '''
            SELECT p.*, u.name as user_name, u.username, u.avatar 
            FROM likes l 
            JOIN posts p ON l.post_id = p.id 
            JOIN users u ON p.user_id = u.id 
            WHERE l.user_id = %s ORDER BY p.id DESC
        '''
        cursor.execute(query, (user_id,))
    else:
        query = '''
            SELECT p.*, u.name as user_name, u.username, u.avatar 
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.user_id = %s ORDER BY p.id DESC
        '''
        cursor.execute(query, (user_id,))

    rows = cursor.fetchall()
    posts = []

    for row in rows:
        post_id = row['id']
        cursor.execute("SELECT COUNT(*) as cnt FROM likes WHERE post_id = %s", (post_id,))
        likes_count = cursor.fetchone()['cnt']

        cursor.execute("SELECT 1 FROM likes WHERE user_id = %s AND post_id = %s", (current_user_id, post_id))
        is_liked = cursor.fetchone() is not None

        cursor.execute("SELECT c.text, u.name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = %s", (post_id,))
        comments = [{"name": c["name"], "text": c["text"]} for c in cursor.fetchall()]

        posts.append({
            "id": post_id,
            "file_url": row["file_url"],
            "media_type": row["media_type"],
            "caption": row["caption"],
            "created_at": str(row["created_at"]),
            "user_name": row["user_name"],
            "username": row["username"],
            "avatar": row["avatar"],
            "likes_count": likes_count,
            "is_liked": is_liked,
            "comments": comments
        })

    cursor.close()
    conn.close()
    return jsonify(posts)


@app.route('/api/posts/create', methods=['POST'])
def create_post():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user_id = get_current_user_id()

    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "Файл не загружен"}), 400

    file = request.files['file']
    caption = request.form.get('caption', '').strip()

    if not file or not file.filename:
        return jsonify({"status": "error", "message": "Файл не выбран"}), 400

    filename = secure_filename(file.filename)
    extension = filename.lower().split('.')[-1]

    video_extensions = {'mp4', 'mov', 'avi', 'webm', 'mkv'}

    if extension in video_extensions:
        media_type = 'video'
        resource_type = 'video'
    else:
        media_type = 'image'
        resource_type = 'image'

    try:
        result = cloudinary.uploader.upload(
            file,
            resource_type=resource_type,
            folder='worldlink/posts'
        )

        file_url = result['secure_url']

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO posts (user_id, file_url, media_type, caption)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (current_user_id, file_url, media_type, caption))

        post_id = cursor.fetchone()['id']
        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({
            "status": "success",
            "post_id": post_id,
            "file_url": file_url,
            "media_type": media_type
        })

    except Exception as e:
        print("Cloudinary upload error:", e)
        return jsonify({"status": "error", "message": "Не удалось загрузить файл"}), 500


@app.route('/api/posts//like', methods=['POST'])
def toggle_like(post_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT 1 FROM likes WHERE user_id = %s AND post_id = %s", (current_user_id, post_id))
    is_liked = cursor.fetchone()

    if is_liked:
        cursor.execute("DELETE FROM likes WHERE user_id = %s AND post_id = %s", (current_user_id, post_id))
        liked = False
    else:
        cursor.execute("INSERT INTO likes (user_id, post_id) VALUES (%s, %s)", (current_user_id, post_id))
        liked = True

    conn.commit()
    cursor.execute("SELECT COUNT(*) as cnt FROM likes WHERE post_id = %s", (post_id,))
    likes_count = cursor.fetchone()['cnt']
    cursor.close()
    conn.close()

    return jsonify({"status": "success", "is_liked": liked, "likes_count": likes_count})


@app.route('/api/posts//comment', methods=['POST'])
def add_comment(post_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    current_user_id = get_current_user_id()
    data = request.json or {}
    text = data.get('text', '').strip()

    if not text:
        return jsonify({"status": "error", "message": "Пустой текст"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO comments (post_id, user_id, text) VALUES (%s, %s, %s)", (post_id, current_user_id, text))
    conn.commit()

    cursor.execute("SELECT name FROM users WHERE id = %s", (current_user_id,))
    user = cursor.fetchone()
    cursor.close()
    conn.close()

    return jsonify({
        "status": "success",
        "comment": {
            "user_name": user["name"],
            "text": text
        }
    })


@app.route('/api/posts//save', methods=['POST'])
def toggle_save(post_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401
    current_user_id = get_current_user_id()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT 1 FROM saved_posts WHERE user_id = %s AND post_id = %s",
        (current_user_id, post_id)
    )
    is_saved = cursor.fetchone()

    if is_saved:
        cursor.execute("DELETE FROM saved_posts WHERE user_id = %s AND post_id = %s", (current_user_id, post_id))
        saved = False
    else:
        cursor.execute("INSERT INTO saved_posts (user_id, post_id) VALUES (%s, %s)", (current_user_id, post_id))
        saved = True

    conn.commit()
    cursor.close()
    conn.close()
    return jsonify({"status": "success", "is_saved": saved})


if __name__ == '__main__':
    app.run(debug=True)
