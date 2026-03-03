const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const multer   = require('multer');
const crypto   = require('crypto');
const { exec } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

const HISTORY_DIR = path.join(__dirname, 'history');
const IMAGES_DIR  = path.join(__dirname, 'history', 'images');

for (const dir of [HISTORY_DIR, IMAGES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use('/history/images', express.static(IMAGES_DIR));

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Nur Bilder erlaubt'), { status: 400 }), false);
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

function readJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch { return null; }
}

function toSafeFilename(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40);
}


const SYSTEM = `You are a LOCAL, OFFLINE language model. YOUR NAME IS "Wieland".
- You are NOT online and have no internet access.
- You CAN analyse images provided in this conversation.
- You do NOT represent any company (Alibaba, OpenAI, Anthropic, etc.).
Always respond in the exact language of the user's last message.
Speak naturally and concisely. If you don't know something, say so.
You may use *italic*, **bold**, and - bullet points.`;


const OLLAMA_OPTIONS_8B = {
  think:       false,
  num_ctx:     2048,
  num_predict: 1024,
  temperature: 0.7,
};

const OLLAMA_OPTIONS_4B = {
  think:       false,
  num_ctx:     1024,
  num_predict: 512,
  temperature: 0.7,
};

const ALLOWED_MODELS = new Set([
  'qwen3-vl:8b-instruct',
  'qwen3-vl:4b-instruct',
]);

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
        messages: [
          { role: 'user', content: `Generate a very short title (max 5 words, same language as message, no quotes, no punctuation): "${truncated}"` }
        ],
        stream:  false,
        options: { temperature: 0.3, num_predict: 20, num_ctx: 512, think: false },
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

app.get('/api/health', (_req, res) => {
  exec('ollama list', (err, stdout) => {
    res.json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      ollama:    err ? 'unreachable' : 'running',
      models:    stdout || 'none',
    });
  });
});

app.post('/api/chat/stream', upload.single('image'), async (req, res) => {
  const imageFile = req.file ?? null;
  const message   = req.body.message?.trim() || (imageFile ? 'Describe this image' : '');
  if (!message) return res.status(400).json({ error: 'message or image required' });

  const requestedModel = req.body.model || 'qwen3-vl:8b-instruct';
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'qwen3-vl:8b-instruct';
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
      .map(m => ({
        role:    m.role,
        content: (m.content ?? '').replace(/!\[.*?\]\([^)]+\)\n\n?/g, '').trim(),
      }))
      .filter(m => m.content),
    {
      role:    'user',
      content: message,
      ...(imageFile ? { images: [imageFile.buffer.toString('base64')] } : {}),
    },
  ];

  try {
    const ollamaRes = await fetch('http://localhost:11434/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model,
        messages: ollamaMessages,
        stream:   true,
        options: options,

      }),
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

app.post('/api/history/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    res.json({ url: saveImageToDisk(req.file.buffer, req.file.mimetype) });
  } catch (err) {
    console.error('Image save error:', err);
    res.status(500).json({ error: 'Failed to save image' });
  }
});

app.post('/api/history/save', async (req, res) => {
  const { messages, filename, generateTitle } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' });

  try {
    let title = null;
    if (generateTitle) {
      const firstUser = messages.find(m => m.role === 'user')?.content ?? '';
      const clean     = firstUser.replace(/!\[.*?\]\([^)]+\)\n\n?/g, '').trim();
      if (clean) title = await generateChatTitle(clean);
    }

    const targetFilename = path.basename(
      filename ?? `${title ? toSafeFilename(title) : 'chat'}_${Date.now()}.json`
    );
    const filepath = path.join(HISTORY_DIR, targetFilename);
    const existing = fs.existsSync(filepath) ? readJSON(filepath) : null;

    fs.writeFileSync(filepath, JSON.stringify({
      timestamp: existing?.timestamp ?? new Date().toISOString(),
      updated:   new Date().toISOString(),
      title:     title ?? existing?.title ?? null,
      messages,
    }, null, 2), 'utf8');

    res.json({ success: true, filename: targetFilename, title });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: 'Failed to save chat' });
  }
});

app.get('/api/history/:filename', (req, res) => {
  const fp = path.join(HISTORY_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  const data = readJSON(fp);
  if (!data) return res.status(500).json({ error: 'Corrupt file' });
  res.json(data);
});

app.delete('/api/history/:filename', (req, res) => {
  const fp = path.join(HISTORY_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Failed to delete' }); }
});

app.get('/api/history', (_req, res) => {
  try {
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fp    = path.join(HISTORY_DIR, f);
        const stats = fs.statSync(fp);
        const data  = readJSON(fp);
        if (!data) return { filename: f, created: stats.birthtime, messageCount: 0, preview: 'Corrupt file' };
        const firstUser = data.messages?.find(m => m.role === 'user')?.content ?? '';
        return {
          filename:     f,
          created:      stats.birthtime,
          updated:      data.updated ?? stats.mtime,
          messageCount: data.messages?.length ?? 0,
          title:        data.title ?? null,
          preview:      data.title
                        || firstUser.replace(/!\[.*?\]\([^)]+\)\n\n?/g, '').slice(0, 60)
                        || 'Neuer Chat',
        };
      })
      .sort((a, b) => new Date(b.updated ?? b.created) - new Date(a.updated ?? a.created));

    res.json(files);
  } catch (err) {
    console.error('History list error:', err);
    res.status(500).json({ error: 'Failed to list history' });
  }
});


app.use((err, _req, res, _next) => {
  console.error('Unhandled:', err.message);
  res.status(err.status ?? 500).json({ error: err.message || 'Internal server error' });
});


app.listen(PORT, () => {
  console.log(`Wieland http://localhost:${PORT}`);
});