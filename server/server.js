require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const multer   = require('multer');
const crypto   = require('crypto');
const { exec } = require('child_process');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3001;

const JWT_SECRET    = process.env.JWT_SECRET    || (() => { throw new Error('JWT_SECRET env var required'); })();
const JWT_EXPIRES   = process.env.JWT_EXPIRES   || '7d';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'wieland',
  user:     process.env.PGUSER     || 'wieland_user',
  password: process.env.PGPASSWORD || (() => { throw new Error('PGPASSWORD env var required'); })(),
  max:      20,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(32)  NOT NULL UNIQUE,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT         NOT NULL,
        plan          VARCHAR(32)  NOT NULL DEFAULT 'Free',
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chats (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename   VARCHAR(255) NOT NULL,
        title      TEXT,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, filename)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id         SERIAL PRIMARY KEY,
        chat_id    INTEGER     NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role       VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','system')),
        content    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_chats_user_id    ON chats(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chat_messages(chat_id);
    `);
    console.log('DB schema ready.');
  } finally {
    client.release();
  }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({
  origin:      process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

const IMAGES_DIR = path.join(__dirname, 'history', 'images');
fs.mkdirSync(IMAGES_DIR, { recursive: true });
app.use('/history/images', express.static(IMAGES_DIR));

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only images allowed'), { status: 400 }), false);
  },
});

function saveImageToDisk(buffer, mimetype) {
  const ext      = mimetype.split('/')[1].replace('jpeg', 'jpg');
  const hash     = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const filename = `${hash}.${ext}`;
  const filepath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, buffer);
  return `/history/images/${filename}`;
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES, algorithm: 'HS256' });
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function isValidUsername(u) { return typeof u === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(u); }
function isValidEmail(e)    { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 255; }
function isValidPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 128; }
function toSafeFilename(str) {
  return str.toLowerCase().replace(/[^a-z0-9äöüß]/g, '_').replace(/_+/g, '_').slice(0, 40);
}

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body ?? {};

  if (!isValidUsername(username))
    return res.status(400).json({ error: 'Username must be 3–32 chars (letters, digits, _ -)' });
  if (!isValidEmail(email))
    return res.status(400).json({ error: 'Invalid email address' });
  if (!isValidPassword(password))
    return res.status(400).json({ error: 'Password must be 8–128 characters' });

  try {
    const hash   = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, username, email, plan`,
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    const user  = result.rows[0];
    const token = signToken(user.id);
    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email, plan: user.plan },
    });
  } catch (err) {
    if (err.code === '23505') {
      const field = err.constraint?.includes('email') ? 'Email' : 'Username';
      return res.status(409).json({ error: `${field} already taken` });
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await pool.query(
      `SELECT id, username, email, password_hash, plan FROM users WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    const user = result.rows[0];

    const hashToCheck = user?.password_hash ?? '$2b$12$invalidhashfortimingXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const matches     = await bcrypt.compare(password, hashToCheck);

    if (!user || !matches)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, plan: user.plan },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, plan FROM users WHERE id = $1`,
      [req.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

const SYSTEM = `You are a LOCAL, OFFLINE language model. YOUR NAME IS "Wieland".
- You are NOT online and have no internet access.
- You CAN analyse images provided in this conversation.
- You do NOT represent any company (Alibaba, OpenAI, Anthropic, etc.).
Always respond in the exact language of the user's last message.
Speak naturally and concisely. If you don't know something, say so.
You may use *italic*, **bold**, and - bullet points.`;

const OLLAMA_OPTIONS_8B = { think: false, num_ctx: 2048, num_predict: 1024, temperature: 0.7 };
const OLLAMA_OPTIONS_4B = { think: false, num_ctx: 1024, num_predict: 512,  temperature: 0.7 };
const ALLOWED_MODELS    = new Set(['qwen3-vl:8b-instruct', 'qwen3-vl:4b-instruct']);

async function pipeOllamaChatStream(ollamaRes, expressRes) {
  const body   = ollamaRes.body;
  const onLine = (line) => {
    if (!line.trim()) return;
    try {
      const chunk = JSON.parse(line);
      const token = chunk?.message?.content ?? '';
      if (token) expressRes.write(token);
    } catch { }
  };

  if (typeof body.getReader === 'function') {
    const reader  = body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      lines.forEach(onLine);
    }
    if (buf) onLine(buf);
  } else {
    await new Promise((resolve, reject) => {
      let buf = '';
      body.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        lines.forEach(onLine);
      });
      body.on('end',   () => { if (buf) onLine(buf); resolve(); });
      body.on('error', reject);
    });
  }
}

async function generateChatTitle(firstUserMessage) {
  const truncated = firstUserMessage.slice(0, 200);
  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    'qwen3-vl:8b-instruct',
        messages: [{ role: 'user', content: `Generate a very short title (max 5 words, same language as message, no quotes, no punctuation): "${truncated}"` }],
        stream:   false,
        options:  { temperature: 0.3, num_predict: 20, num_ctx: 512, think: false },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error();
    const data  = await res.json();
    let   title = (data?.message?.content ?? '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
    if (title.split(' ').length > 6) title = title.split(' ').slice(0, 6).join(' ') + '…';
    return title || truncated.slice(0, 50);
  } catch {
    return truncated.slice(0, 50);
  }
}

app.post('/api/chat/stream', requireAuth, upload.single('image'), async (req, res) => {
  const imageFile = req.file ?? null;
  const message   = req.body.message?.trim() || (imageFile ? 'Describe this image' : '');
  if (!message) return res.status(400).json({ error: 'message or image required' });

  const requestedModel = req.body.model || 'qwen3-vl:8b-instruct';
  const model   = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'qwen3-vl:8b-instruct';
  const options = model === 'qwen3-vl:4b-instruct' ? OLLAMA_OPTIONS_4B : OLLAMA_OPTIONS_8B;

  let context = [];
  try {
    context = req.body.context ? JSON.parse(req.body.context) : [];
    if (!Array.isArray(context)) context = [];
  } catch { context = []; }

  res.setHeader('Content-Type',      'text/plain; charset=utf-8');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const ollamaMessages = [
    { role: 'system', content: SYSTEM },
    ...context
      .map(m => ({ role: m.role, content: (m.content ?? '').replace(/!\[.*?\]\([^)]+\)\n\n?/g, '').trim() }))
      .filter(m => m.content),
    { role: 'user', content: message, ...(imageFile ? { images: [imageFile.buffer.toString('base64')] } : {}) },
  ];

  try {
    const ollamaRes = await fetch('http://localhost:11434/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, messages: ollamaMessages, stream: true, options }),
    });

    if (!ollamaRes.ok) {
      console.error('Ollama error:', ollamaRes.status, await ollamaRes.text().catch(() => ''));
      return res.status(502).end('Upstream model error');
    }

    req.on('close', () => { try { ollamaRes.body.cancel?.(); } catch {} });
    await pipeOllamaChatStream(ollamaRes, res);
    res.end();
  } catch (err) {
    console.error('Stream error:', err.message);
    if (!res.headersSent) res.status(502).end('Model unavailable');
    else res.end();
  }
});

app.post('/api/history/upload-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    res.json({ url: saveImageToDisk(req.file.buffer, req.file.mimetype) });
  } catch (err) {
    console.error('Image save error:', err);
    res.status(500).json({ error: 'Failed to save image' });
  }
});

app.post('/api/history/save', requireAuth, async (req, res) => {
  const { messages, filename, generateTitle } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let title = null;
    if (generateTitle) {
      const firstUser = messages.find(m => m.role === 'user')?.content ?? '';
      const clean     = firstUser.replace(/!\[.*?\]\([^)]+\)\n\n?/g, '').trim();
      if (clean) title = await generateChatTitle(clean);
    }

    let chatId, targetFilename;

    if (filename) {
      const existing = await client.query(
        `SELECT id FROM chats WHERE user_id = $1 AND filename = $2`,
        [req.userId, filename]
      );
      if (!existing.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Chat not found' }); }

      chatId         = existing.rows[0].id;
      targetFilename = filename;
      await client.query(
        `UPDATE chats SET updated_at = NOW(), title = COALESCE($1, title) WHERE id = $2`,
        [title, chatId]
      );
      await client.query(`DELETE FROM chat_messages WHERE chat_id = $1`, [chatId]);
    } else {
      targetFilename = `${title ? toSafeFilename(title) : 'chat'}_${Date.now()}.json`;
      const result   = await client.query(
        `INSERT INTO chats (user_id, filename, title) VALUES ($1, $2, $3) RETURNING id`,
        [req.userId, targetFilename, title]
      );
      chatId = result.rows[0].id;
    }

    for (const m of messages) {
      if (!m.content) continue;
      await client.query(
        `INSERT INTO chat_messages (chat_id, role, content) VALUES ($1, $2, $3)`,
        [chatId, m.role === 'user' ? 'user' : 'assistant', m.content]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, filename: targetFilename, title });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Save error:', err.message);
    res.status(500).json({ error: 'Failed to save chat' });
  } finally {
    client.release();
  }
});

app.get('/api/history/:filename', requireAuth, async (req, res) => {
  try {
    const chatResult = await pool.query(
      `SELECT id, title, created_at, updated_at FROM chats WHERE user_id = $1 AND filename = $2`,
      [req.userId, req.params.filename]
    );
    if (!chatResult.rows[0]) return res.status(404).json({ error: 'Not found' });

    const chat      = chatResult.rows[0];
    const msgResult = await pool.query(
      `SELECT role, content FROM chat_messages WHERE chat_id = $1 ORDER BY created_at ASC, id ASC`,
      [chat.id]
    );
    res.json({ title: chat.title, timestamp: chat.created_at, updated: chat.updated_at, messages: msgResult.rows });
  } catch (err) {
    console.error('Get chat error:', err.message);
    res.status(500).json({ error: 'Failed to load chat' });
  }
});


app.delete('/api/history/:filename', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM chats WHERE user_id = $1 AND filename = $2 RETURNING id`,
      [req.userId, req.params.filename]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.filename, c.title, c.created_at, c.updated_at,
         COUNT(cm.id)::int AS message_count,
         (SELECT cm2.content FROM chat_messages cm2
          WHERE cm2.chat_id = c.id AND cm2.role = 'user'
          ORDER BY cm2.created_at ASC, cm2.id ASC LIMIT 1) AS first_user_message
       FROM chats c
       LEFT JOIN chat_messages cm ON cm.chat_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
      [req.userId]
    );
    res.json(result.rows.map(row => ({
      filename:     row.filename,
      created:      row.created_at,
      updated:      row.updated_at,
      messageCount: row.message_count,
      title:        row.title ?? null,
      preview:      row.title
                    || (row.first_user_message ?? '').replace(/!\[.*?\]\([^)]+\)\n\n?/g, '').slice(0, 60)
                    || 'Neuer Chat',
    })));
  } catch (err) {
    console.error('History list error:', err.message);
    res.status(500).json({ error: 'Failed to list history' });
  }
});

app.get('/api/health', (_req, res) => {
  exec('ollama list', (err, stdout) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), ollama: err ? 'unreachable' : 'running', models: stdout || 'none' });
  });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled:', err.message);
  res.status(err.status ?? 500).json({ error: err.message || 'Internal server error' });
});


initDB().then(() => {
  app.listen(PORT, () => console.log(`Wieland http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});