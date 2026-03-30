/* ════════════════════════════════════════════
   Wieland AI · Chrome Extension – App Logic
   ════════════════════════════════════════════ */

const API_BASE = 'http://localhost:3001';

const WELCOME_MESSAGES = [
  'Was geht dir heute durch den Kopf?',
  'Was liegt heute an?',
  'Wobei kann ich dir heute helfen?',
  'Schön, dass du hier bist!',
  'Worüber möchtest du sprechen?',
];

const MODELS = [
  { id: 'qwen3-vl:2b-instruct', label: '2B · Free', rank: 0 },
  { id: 'qwen3-vl:4b-instruct', label: '4B · Pro',  rank: 1 },
  { id: 'qwen3-vl:8b-instruct', label: '8B · Präzise', rank: 2 },
];

const WEBSITE_SUMMARY_PROMPT_RE = /(webseite|website|seite|zusammenfass|wichtigste|hauptpunkte|zusammenfassung|summar(y|ize)|key\s*points)/i;

let token = null;
let user = null;
let currentChatId = null;
let messages = [];
let isSending = false;
let abortController = null;
let selectedModel = 'qwen3-vl:2b-instruct';
let aiStyle = 'formal';
let imageFile = null;
let imagePreview = null;
let sidebarOpen = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const authScreen   = $('#auth-screen');
const chatScreen   = $('#chat-screen');
const authTabs     = $$('.auth-tab');
const authTitle    = $('#auth-title');
const authSubtitle = $('#auth-subtitle');
const fieldUsername = $('#field-username');
const fieldConfirm = $('#field-confirm');
const inputUsername = $('#input-username');
const inputEmail   = $('#input-email');
const inputPassword= $('#input-password');
const inputConfirm = $('#input-confirm');
const authError    = $('#auth-error');
const authSubmit   = $('#auth-submit');
const authSubmitTxt= $('#auth-submit-text');
const authSpinner  = $('#auth-spinner');
const authSwitchTxt= $('#auth-switch-text');
const authSwitchLnk= $('#auth-switch-link');

const messagesArea  = $('#messages-area');
const welcomeEl     = $('#welcome-container');
const welcomeText   = $('#welcome-text');
const chatInput     = $('#chat-input');
const btnSend       = $('#btn-send');
const btnStop       = $('#btn-stop');
const btnPlus       = $('#btn-plus');
const plusMenu      = $('#plus-menu');
const btnUploadImg  = $('#btn-upload-image');
const fileInput     = $('#file-input');
const imgPreviewBar = $('#image-preview-bar');
const imgPreviewImg = $('#image-preview-img');
const imgPillName   = $('#image-pill-name');
const btnRemoveImg  = $('#btn-remove-image');
const btnModel      = $('#btn-model');
const modelLabel    = $('#model-label');
const modelDropdown = $('#model-dropdown');
const modelOptions  = $$('.model-option');
const sidebar       = $('#sidebar');
const sidebarOverlay= $('#sidebar-overlay');
const btnToggleSB   = $('#btn-toggle-sidebar');
const btnNewChat    = $('#btn-new-chat');
const chatListEl    = $('#chat-list');
const sidebarAvatar = $('#sidebar-avatar');
const sidebarName   = $('#sidebar-name');
const sidebarPlan   = $('#sidebar-plan');
const btnLogout     = $('#btn-logout');

let authMode = 'login';

function initStarsBackground() {
  const c = document.getElementById('stars-canvas');
  if (!c) return;

  const ctx = c.getContext('2d');
  if (!ctx) return;

  let W = 0;
  let H = 0;
  let stars = [];
  let frame = null;

  function build() {
    stars = Array.from({ length: 320 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.3 + 0.12,
      a: Math.random() * 0.85 + 0.1,
      sp: (Math.random() * 0.22 + 0.06) * (Math.random() > 0.5 ? 1 : -1),
      t: Math.random() * Math.PI * 2,
    }));
  }

  function resize() {
    W = c.width = window.innerWidth;
    H = c.height = window.innerHeight;
    build();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const now = performance.now() / 1000;
    for (const s of stars) {
      const alpha = s.a * (0.4 + 0.6 * Math.sin(now * Math.abs(s.sp) + s.t));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(185,215,255,${alpha})`;
      ctx.fill();
    }
    frame = requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  draw();

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('resize', resize);
    if (frame) cancelAnimationFrame(frame);
  }, { once: true });
}

async function init() {
  welcomeText.textContent = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];

  const stored = await chromeGet(['wieland_token', 'wieland_user']);
  if (stored.wieland_token && stored.wieland_user) {
    token = stored.wieland_token;
    user = stored.wieland_user;

    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        user = data.user;
        await chromeSet({ wieland_user: user });
      } else {
        throw new Error('expired');
      }
    } catch {
      token = null;
      user = null;
      await chromeRemove(['wieland_token', 'wieland_user']);
    }
  }

  if (token && user) {
    showChat();
  } else {
    showAuth();
  }
}

function chromeGet(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}
function chromeSet(obj) {
  return new Promise(r => chrome.storage.local.set(obj, r));
}
function chromeRemove(keys) {
  return new Promise(r => chrome.storage.local.remove(keys, r));
}

function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { ...opts, headers });
}

function showAuth() {
  authScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
  setAuthMode('login');
}

function setAuthMode(mode) {
  authMode = mode;
  authTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  fieldUsername.classList.toggle('hidden', mode === 'login');
  fieldConfirm.classList.toggle('hidden', mode === 'login');
  authError.classList.add('hidden');
  inputUsername.value = '';
  inputEmail.value = '';
  inputPassword.value = '';
  inputConfirm.value = '';

  if (mode === 'login') {
    authTitle.textContent = 'Willkommen zurück';
    authSubtitle.textContent = 'Melde dich an, um Nachrichten zu senden';
    authSubmitTxt.textContent = 'Anmelden';
    authSwitchTxt.textContent = 'Noch kein Konto?';
    authSwitchLnk.textContent = 'Registrieren';
  } else {
    authTitle.textContent = 'Konto erstellen';
    authSubtitle.textContent = 'Kostenlos starten — läuft vollständig offline';
    authSubmitTxt.textContent = 'Registrieren';
    authSwitchTxt.textContent = 'Bereits ein Konto?';
    authSwitchLnk.textContent = 'Anmelden';
  }
}

authTabs.forEach(t => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));
authSwitchLnk.addEventListener('click', (e) => {
  e.preventDefault();
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});

authSubmit.addEventListener('click', handleAuth);
$('#auth-form').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAuth();
});

async function handleAuth() {
  const email = inputEmail.value.trim();
  const password = inputPassword.value;
  const username = inputUsername.value.trim();
  const confirm = inputConfirm.value;

  if (authMode === 'register') {
    if (!username || !email || !password || !confirm)
      return showAuthError('Bitte alle Felder ausfüllen.');
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username))
      return showAuthError('Benutzername: 3–32 Zeichen (Buchstaben, Ziffern, _ -)');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return showAuthError('Ungültige E-Mail-Adresse.');
    if (password.length < 8)
      return showAuthError('Passwort muss mindestens 8 Zeichen lang sein.');
    if (password !== confirm)
      return showAuthError('Passwörter stimmen nicht überein.');
  } else {
    if (!email || !password)
      return showAuthError('Bitte alle Felder ausfüllen.');
  }

  authSubmit.disabled = true;
  authSubmitTxt.classList.add('hidden');
  authSpinner.classList.remove('hidden');
  authError.classList.add('hidden');

  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = authMode === 'login'
      ? { email, password }
      : { username, email, password };

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) return showAuthError(data.error || 'Fehler aufgetreten.');

    token = data.token;
    user = data.user;
    await chromeSet({ wieland_token: token, wieland_user: user });
    showChat();
  } catch {
    showAuthError('Server nicht erreichbar.');
  } finally {
    authSubmit.disabled = false;
    authSubmitTxt.classList.remove('hidden');
    authSpinner.classList.add('hidden');
  }
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

function showChat() {
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : '??';
  sidebarAvatar.textContent = initials;
  sidebarName.textContent = user?.username ?? '—';
  sidebarPlan.textContent = user?.plan ?? 'Free';

  updateModelForPlan();
  updateModelDropdown();

  loadChatList();

  handleNewChat();
}

function planRank(plan) {
  const p = (plan || 'Free').toLowerCase();
  if (p === 'admin' || p === 'max') return 2;
  if (p === 'pro') return 1;
  return 0;
}

function updateModelForPlan() {
  const rank = planRank(user?.plan);
  if (rank >= 2) selectedModel = 'qwen3-vl:8b-instruct';
  else if (rank >= 1) selectedModel = 'qwen3-vl:4b-instruct';
  else selectedModel = 'qwen3-vl:2b-instruct';
  const m = MODELS.find(m => m.id === selectedModel);
  modelLabel.textContent = m?.label || selectedModel;
}

function updateModelDropdown() {
  const rank = planRank(user?.plan);
  modelOptions.forEach(opt => {
    const model = MODELS.find(m => m.id === opt.dataset.model);
    opt.classList.toggle('active', opt.dataset.model === selectedModel);
    opt.classList.toggle('locked', model && model.rank > rank);
  });
}

btnModel.addEventListener('click', () => modelDropdown.classList.toggle('hidden'));
document.addEventListener('click', (e) => {
  if (!btnModel.contains(e.target) && !modelDropdown.contains(e.target))
    modelDropdown.classList.add('hidden');
});

modelOptions.forEach(opt => {
  opt.addEventListener('click', () => {
    const model = MODELS.find(m => m.id === opt.dataset.model);
    if (model && model.rank > planRank(user?.plan)) return;
    selectedModel = opt.dataset.model;
    modelLabel.textContent = opt.textContent;
    updateModelDropdown();
    modelDropdown.classList.add('hidden');
  });
});

btnToggleSB.addEventListener('click', () => toggleSidebar(!sidebarOpen));
sidebarOverlay.addEventListener('click', () => toggleSidebar(false));

function toggleSidebar(open) {
  sidebarOpen = open;
  sidebar.classList.toggle('open', open);
  sidebarOverlay.classList.toggle('hidden', !open);
  btnToggleSB.classList.toggle('sidebar-open', open);
}

btnNewChat.addEventListener('click', () => {
  handleNewChat();
  toggleSidebar(false);
});

btnLogout.addEventListener('click', async () => {
  token = null;
  user = null;
  await chromeRemove(['wieland_token', 'wieland_user']);
  showAuth();
});

async function loadChatList() {
  try {
    const res = await apiFetch('/api/history');
    if (!res.ok) return;
    const data = await res.json();
    const chats = Array.isArray(data) ? data : data.chats || [];
    renderChatList(chats);
  } catch (e) {
    console.error('loadChatList error:', e);
  }
}

function renderChatList(chats) {
  if (!chats.length) {
    chatListEl.innerHTML = '<p class="no-chats">Keine Chats vorhanden</p>';
    return;
  }
  chatListEl.innerHTML = '';
  chats.forEach(chat => {
    const div = document.createElement('div');
    div.className = `chat-item${chat.filename === currentChatId ? ' active' : ''}`;
    div.innerHTML = `
      <span class="chat-item-name">${escapeHtml(chat.preview || chat.title || 'Chat')}</span>
      <button class="chat-item-delete" title="Löschen">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>`;
    div.querySelector('.chat-item-name').addEventListener('click', () => {
      loadChat(chat.filename);
      toggleSidebar(false);
    });
    div.querySelector('.chat-item-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.filename);
    });
    chatListEl.appendChild(div);
  });
}

async function loadChat(filename) {
  try {
    const res = await apiFetch(`/api/history/${filename}`);
    if (!res.ok) return;
    const data = await res.json();
    messages = (data.messages || []).map((m, i) => ({
      content: m.content,
      isUser: m.role === 'user',
      id: `loaded-${i}-${uid()}`,
    }));
    currentChatId = filename;
    renderMessages();
    loadChatList();
  } catch (e) {
    console.error('loadChat error:', e);
  }
}

async function deleteChat(filename) {
  try {
    const res = await apiFetch(`/api/history/${filename}`, { method: 'DELETE' });
    if (res.ok) {
      if (currentChatId === filename) handleNewChat();
      loadChatList();
    }
  } catch (e) {
    console.error('deleteChat error:', e);
  }
}

function handleNewChat() {
  if (abortController) abortController.abort();
  messages = [];
  currentChatId = null;
  isSending = false;
  chatInput.value = '';
  clearImage();
  renderMessages();
  chatInput.focus();
}

btnPlus.addEventListener('click', (e) => {
  e.stopPropagation();
  plusMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!plusMenu.contains(e.target) && !btnPlus.contains(e.target))
    plusMenu.classList.add('hidden');
});

btnUploadImg.addEventListener('click', () => {
  fileInput.click();
  plusMenu.classList.add('hidden');
});

$$('.plus-menu-item[data-style]').forEach(btn => {
  btn.addEventListener('click', () => {
    aiStyle = btn.dataset.style;
    $$('.plus-menu-item[data-style]').forEach(b => b.classList.remove('active-style'));
    btn.classList.add('active-style');
    plusMenu.classList.add('hidden');
  });
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Nur Bilder erlaubt.', 'error'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('Bild zu groß (max 10 MB).', 'error'); return; }
  imageFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    imagePreview = ev.target.result;
    imgPreviewImg.src = imagePreview;
    imgPillName.textContent = file.name;
    imgPreviewBar.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

btnRemoveImg.addEventListener('click', clearImage);

function clearImage() {
  imageFile = null;
  imagePreview = null;
  imgPreviewBar.classList.add('hidden');
  imgPreviewImg.src = '';
  fileInput.value = '';
}

function shouldAttachWebsiteContext(text = '') {
  return WEBSITE_SUMMARY_PROMPT_RE.test(text);
}

function buildWebsiteContextPrompt(page) {
  const title = (page?.title || '').trim();
  const url = (page?.url || '').trim();
  const content = (page?.content || '').trim();
  if (!content) return '';
  return [
    '',
    'Nutze den folgenden Seitenkontext, um die Frage zu beantworten.',
    `Seitentitel: ${title || 'Unbekannt'}`,
    `URL: ${url || 'Unbekannt'}`,
    'Seiteninhalt:',
    content,
  ].join('\n');
}

async function getActivePageContext() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url) return null;
    if (/^(chrome|chrome-extension|edge|about|view-source):/i.test(tab.url)) return null;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const root = document.querySelector('main, article, [role="main"]') || document.body;
        const title = document.title || '';
        const url = location.href || '';

        const chunks = [];
        const headingNodes = root.querySelectorAll('h1, h2, h3');
        for (const node of headingNodes) {
          const t = (node.textContent || '').trim();
          if (t) chunks.push(t);
          if (chunks.length >= 80) break;
        }

        const textNodes = root.querySelectorAll('p, li');
        for (const node of textNodes) {
          const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length > 25) chunks.push(t);
          if (chunks.length >= 280) break;
        }

        let content = chunks.join('\n');
        content = content.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (content.length > 12000) content = content.slice(0, 12000);

        return { title, url, content };
      },
    });

    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

chatInput.addEventListener('input', () => {
  btnSend.disabled = !chatInput.value.trim() && !imagePreview;
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isSending) {
    e.preventDefault();
    sendMessage();
  }
});

btnSend.addEventListener('click', sendMessage);
btnStop.addEventListener('click', () => abortController?.abort());

async function sendMessage() {
  const text = chatInput.value.trim() || (imageFile ? 'Beschreibe dieses Bild' : '');
  if (!text || isSending) return;

  isSending = true;
  chatInput.value = '';
  chatInput.style.height = 'auto';
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  btnSend.disabled = true;

  let imageUrl = null;
  const fileCopy = imageFile;
  let requestText = text;

  if (shouldAttachWebsiteContext(text)) {
    const page = await getActivePageContext();
    const pageBlock = buildWebsiteContextPrompt(page);
    if (pageBlock) requestText = `${text}${pageBlock}`;
    else toast('Konnte die aktuelle Seite nicht auslesen.', 'error');
  }

  if (fileCopy) {
    clearImage();
    try {
      const fd = new FormData();
      fd.append('image', fileCopy);
      const upRes = await apiFetch('/api/history/upload-image', { method: 'POST', body: fd });
      if (upRes.ok) {
        const upData = await upRes.json();
        imageUrl = upData.url;
      }
    } catch {}
  }

  const userContent = imageUrl ? `![Bild](${imageUrl})\n\n${text}` : text;
  const userMsg = { content: userContent, isUser: true, id: uid() };
  messages.push(userMsg);
  renderMessages();
  scrollToBottom();

  const context = messages.slice(0, -1).map(m => ({
    role: m.isUser ? 'user' : 'assistant',
    content: stripImg(m.content),
  }));

  const aiId = uid();
  messages.push({ content: '', isUser: false, id: aiId });
  renderMessages();
  scrollToBottom();

  abortController = new AbortController();
  let fullText = '';

  try {
    const fd = new FormData();
    fd.append('message', requestText);
    fd.append('context', JSON.stringify(context));
    fd.append('model', selectedModel);
    fd.append('aiStyle', aiStyle);
    if (fileCopy) fd.append('image', fileCopy);

    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: fd,
      signal: abortController.signal,
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      updateMessage(aiId, fullText);
      scrollToBottom();
    }

    const isNew = !currentChatId && messages.filter(m => m.isUser).length === 1;
    await saveChat(isNew);
    loadChatList();

  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Stream error:', err);
      updateMessage(aiId, fullText || 'Fehler bei der Kommunikation mit dem Server.');
    } else if (fullText) {
      updateMessage(aiId, fullText);
      await saveChat(false);
      loadChatList();
    }
  } finally {
    abortController = null;
    isSending = false;
    btnStop.classList.add('hidden');
    btnSend.classList.remove('hidden');
    btnSend.disabled = !chatInput.value.trim();
  }
}

function updateMessage(id, content) {
  const msg = messages.find(m => m.id === id);
  if (msg) msg.content = content;
  const el = document.querySelector(`[data-msg-id="${id}"] .message-bubble`);
  if (el) el.innerHTML = content ? renderMarkdown(content) : typingLoaderHTML();
}

async function saveChat(generateTitle = false) {
  try {
    await apiFetch('/api/history/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.content })),
        filename: currentChatId || undefined,
        generateTitle,
      }),
    }).then(async res => {
      if (res.ok) {
        const data = await res.json();
        if (data.filename && !currentChatId) currentChatId = data.filename;
      }
    });
  } catch (e) {
    console.error('saveChat error:', e);
  }
}

function renderMessages() {
  messagesArea.innerHTML = '';

  if (messages.length === 0) {
    messagesArea.innerHTML = `
      <div class="welcome-container">
        <span class="welcome-text">${WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)]}</span>
      </div>`;
    return;
  }

  messages.forEach((msg, idx) => {
    messagesArea.appendChild(createMessageEl(msg, idx));
  });
  scrollToBottom();
}

function createMessageEl(msg, idx) {
  const div = document.createElement('div');
  div.className = `message ${msg.isUser ? 'user-message' : 'ai-message'}`;
  div.dataset.msgId = msg.id;

  const imageUrl = extractImageUrl(msg.content);
  const textOnly = stripImg(msg.content);

  let bubbleHTML = '';
  if (msg.isUser) {
    if (imageUrl) bubbleHTML += `<img class="message-image" src="${API_BASE}${imageUrl}" alt="Bild"/>`;
    bubbleHTML += escapeHtml(textOnly);
  } else {
    bubbleHTML = msg.content ? renderMarkdown(msg.content) : typingLoaderHTML();
  }

  div.innerHTML = `
    <div class="message-bubble">${bubbleHTML}</div>
    <div class="message-actions">
      ${!msg.isUser && msg.content ? `
        <button class="msg-action-btn" data-action="regenerate" title="Neu generieren">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
        </button>` : ''}
      <button class="msg-action-btn" data-action="copy" title="Kopieren">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
    </div>`;

  div.querySelectorAll('.msg-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'copy') {
        navigator.clipboard.writeText(stripImg(msg.content));
        toast('Kopiert!', 'success');
      } else if (btn.dataset.action === 'regenerate') {
        regenerate();
      }
    });
  });

  return div;
}

async function regenerate() {
  if (isSending || !messages.length) return;
  const aiIdx = messages.reduceRight((f, m, i) => f === -1 && !m.isUser ? i : f, -1);
  if (aiIdx === -1) return;
  const uIdx = messages.slice(0, aiIdx).reduceRight((f, m, i) => f === -1 && m.isUser ? i : f, -1);
  if (uIdx === -1) return;

  const userMsg = messages[uIdx];
  messages = messages.slice(0, aiIdx);
  renderMessages();

  isSending = true;
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
  abortController = new AbortController();

  const aiId = uid();
  messages.push({ content: '', isUser: false, id: aiId });
  renderMessages();

  const context = messages.slice(0, -1).map(m => ({
    role: m.isUser ? 'user' : 'assistant',
    content: stripImg(m.content),
  }));

  let fullText = '';
  try {
    const fd = new FormData();
    let requestText = stripImg(userMsg.content);
    if (shouldAttachWebsiteContext(requestText)) {
      const page = await getActivePageContext();
      const pageBlock = buildWebsiteContextPrompt(page);
      if (pageBlock) requestText = `${requestText}${pageBlock}`;
    }

    fd.append('message', requestText);
    fd.append('context', JSON.stringify(context.slice(0, -1)));
    fd.append('model', selectedModel);
    fd.append('aiStyle', aiStyle);

    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: fd,
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      updateMessage(aiId, fullText);
      scrollToBottom();
    }

    await saveChat(false);
    loadChatList();
  } catch (err) {
    if (err.name !== 'AbortError') {
      updateMessage(aiId, fullText || 'Fehler.');
    }
  } finally {
    abortController = null;
    isSending = false;
    btnStop.classList.add('hidden');
    btnSend.classList.remove('hidden');
  }
}

function renderMarkdown(raw = '') {
  let html = raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/gs, '<strong>$1</strong>')
    .replace(/__(.*?)__/gs, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gs, '<em>$1</em>')
    .replace(/_(.*?)_/gs, '<em>$1</em>')
    .replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br/>');

  html = html.replace(/((?:<li>.*?<\/li>(?:<br\/>)?)+)/g, '<ul>$1</ul>');
  html = html.replace(/<ul>(.*?)<\/ul>/gs, (_, inner) =>
    '<ul>' + inner.replace(/<br\/>/g, '') + '</ul>');

  return html;
}

function typingLoaderHTML() {
  return `<div class="typing-loader">
    <div class="circle"><div class="dot"></div></div>
    <div class="circle"><div class="dot"></div></div>
    <div class="circle"><div class="dot"></div></div>
    <div class="circle"><div class="dot"></div></div>
  </div>`;
}

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function stripImg(text = '') {
  return text.replace(/!\[.*?\]\([^)]+\)\n\n?/g, '').trim();
}

function extractImageUrl(content = '') {
  const m = content.match(/!\[.*?\]\(([^)]+)\)/);
  return m ? m[1] : null;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  });
}

function toast(msg, type = 'error') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

initStarsBackground();
init();
