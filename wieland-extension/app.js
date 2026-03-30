const API_BASE = "http://localhost:3001";

const EXT_LANG_KEY = "wieland_lang";
const TOKEN_KEY = "wieland_token";
const USER_KEY = "wieland_user";
const EXT_WEB_ACCESS_KEY = "wieland_ext_internet_access";
const AUTH_COOKIE_KEY = "wieland_ext_token";
const WEBSITE_LANG_COOKIE_KEY = "wieland_lang";
const MAIN_WEBSITE_HOSTS = ["localhost", "127.0.0.1"];
const LANG_SYNC_INTERVAL_MS = 1500;
const SUPPORTED_LANGS = ["de", "en", "it"];
const I18N = Object.fromEntries(SUPPORTED_LANGS.map((lang) => [lang, {}]));
let localesLoaded = false;

async function loadLocales() {
  if (localesLoaded) return;

  const results = await Promise.all(
    SUPPORTED_LANGS.map(async (lang) => {
      try {
        const url = chrome?.runtime?.getURL
          ? chrome.runtime.getURL(`locales/${lang}.json`)
          : `locales/${lang}.json`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return [lang, json];
      } catch (error) {
        console.error(`Failed to load locale '${lang}'`, error);
        return [lang, {}];
      }
    }),
  );

  for (const [lang, dict] of results) {
    I18N[lang] = dict;
  }

  localesLoaded = true;
}

let currentLang = "de";
let languageSyncTimer = null;

function normalizeLang(raw) {
  const val = String(raw || "")
    .toLowerCase()
    .split("-")[0]
    .trim();
  return SUPPORTED_LANGS.includes(val) ? val : null;
}

function parseBoolean(value) {
  return value === true || value === "1" || value === "true";
}

function tr(key, vars = {}) {
  const lookup = (obj) =>
    key.split(".").reduce((acc, part) => acc?.[part], obj);
  const fromLang = lookup(I18N[currentLang]);
  const fromDe = lookup(I18N.de);
  const template =
    typeof fromLang === "string"
      ? fromLang
      : typeof fromDe === "string"
        ? fromDe
        : key;
  return template.replace(/\{(\w+)\}/g, (_, token) =>
    String(vars[token] ?? ""),
  );
}

function trArray(key) {
  const lookup = (obj) =>
    key.split(".").reduce((acc, part) => acc?.[part], obj);
  const val = lookup(I18N[currentLang]);
  if (Array.isArray(val)) return val;
  return lookup(I18N.de) || [];
}

function setAuthCookie(value) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${AUTH_COOKIE_KEY}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function getAuthCookie() {
  const m = document.cookie.match(
    new RegExp(`(?:^|; )${AUTH_COOKIE_KEY}=([^;]+)`),
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function clearAuthCookie() {
  document.cookie = `${AUTH_COOKIE_KEY}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
}

function chromeCookieGet(details) {
  return new Promise((resolve) => {
    if (!chrome.cookies?.get) {
      resolve(null);
      return;
    }
    chrome.cookies.get(details, (cookie) => {
      if (chrome.runtime?.lastError) {
        resolve(null);
        return;
      }
      resolve(cookie || null);
    });
  });
}

async function detectWebsiteLanguageFromCookies() {
  const urls = [
    "http://localhost/",
    "https://localhost/",
    "http://127.0.0.1/",
    "https://127.0.0.1/",
  ];

  for (const url of urls) {
    const direct = await chromeCookieGet({
      url,
      name: WEBSITE_LANG_COOKIE_KEY,
    });
    const directLang = normalizeLang(direct?.value);
    if (directLang) return directLang;

    const i18next = await chromeCookieGet({ url, name: "i18next" });
    const i18nextLang = normalizeLang(i18next?.value);
    if (i18nextLang) return i18nextLang;
  }

  return null;
}

const MODELS = [
  { id: "qwen3-vl:2b-instruct", labelKey: "models.free", rank: 0 },
  { id: "qwen3-vl:4b-instruct", labelKey: "models.pro", rank: 1 },
  { id: "qwen3-vl:8b-instruct", labelKey: "models.precise", rank: 2 },
];

function getModelLabel(modelId) {
  const model = MODELS.find((m) => m.id === modelId);
  return model ? tr(model.labelKey) : modelId;
}

async function detectWebsiteLanguage() {
  try {
    const isMainWebsiteTab = (tabUrl) => {
      if (
        !tabUrl ||
        /^(chrome|chrome-extension|edge|about|view-source):/i.test(tabUrl)
      )
        return false;
      try {
        const u = new URL(tabUrl);
        return MAIN_WEBSITE_HOSTS.includes(u.hostname.toLowerCase());
      } catch {
        return false;
      }
    };

    const extractLangFromUrl = (tabUrl) => {
      try {
        const u = new URL(tabUrl);
        const fromPath = normalizeLang(
          u.pathname.match(/^\/(de|en|it)(\/|$)/i)?.[1],
        );
        if (fromPath) return fromPath;

        const hashPath = u.hash.replace(/^#\/?/, "/");
        const fromHash = normalizeLang(
          hashPath.match(/^\/(de|en|it)(\/|$)/i)?.[1],
        );
        return fromHash;
      } catch {
        return null;
      }
    };

    const allTabs = await chrome.tabs.query({ windowType: "normal" });
    const websiteTabs = allTabs.filter((t) => isMainWebsiteTab(t.url));
    if (!websiteTabs.length) return null;

    const activeFocused = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const activeFocusedId = activeFocused?.[0]?.id;

    const scoreTab = (tab) => {
      let score = 0;
      if (extractLangFromUrl(tab.url)) score += 100;
      if (tab.id && activeFocusedId && tab.id === activeFocusedId) score += 20;
      if (tab.active) score += 10;
      return score;
    };

    const tab =
      [...websiteTabs].sort((a, b) => scoreTab(b) - scoreTab(a))[0] || null;

    if (!tab?.id || !tab.url) return null;

    const fromUrl = extractLangFromUrl(tab.url);
    if (fromUrl) return fromUrl;

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const readCookie = (key) => {
          const m = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]+)`));
          if (!m?.[1]) return null;
          try {
            return decodeURIComponent(m[1]);
          } catch {
            return m[1];
          }
        };

        const fromPath =
          location.pathname.match(/^\/(de|en|it)(\/|$)/i)?.[1] || null;
        let fromStorageWieland = null;
        let fromStorageI18next = null;
        try {
          fromStorageWieland = localStorage.getItem("wieland_lang");
          fromStorageI18next = localStorage.getItem("i18nextLng");
        } catch {}

        const fromHtml = document.documentElement?.lang || null;
        const fromCookieWieland = readCookie("wieland_lang");
        const fromCookieI18next = readCookie("i18next");

        return {
          fromPath,
          fromStorageWieland,
          fromStorageI18next,
          fromHtml,
          fromCookieWieland,
          fromCookieI18next,
        };
      },
    });

    const sourceValues = result?.[0]?.result || {};
    const candidates = [
      normalizeLang(sourceValues.fromPath),
      normalizeLang(sourceValues.fromStorageWieland),
      normalizeLang(sourceValues.fromStorageI18next),
      normalizeLang(sourceValues.fromHtml),
      normalizeLang(sourceValues.fromCookieWieland),
      normalizeLang(sourceValues.fromCookieI18next),
    ];

    return candidates.find(Boolean) || null;
  } catch {
    return null;
  }
}

async function resolveLanguage() {
  const stored = await chromeGet([EXT_LANG_KEY]);
  const fromWebsite = await detectWebsiteLanguage();
  if (fromWebsite) {
    await chromeSet({ [EXT_LANG_KEY]: fromWebsite });
    return fromWebsite;
  }

  const fromWebsiteCookie = await detectWebsiteLanguageFromCookies();
  if (fromWebsiteCookie) {
    await chromeSet({ [EXT_LANG_KEY]: fromWebsiteCookie });
    return fromWebsiteCookie;
  }

  const fromStorage = normalizeLang(stored?.[EXT_LANG_KEY]);
  if (fromStorage) return fromStorage;

  return normalizeLang(navigator.language) || "de";
}

async function syncLanguageFromWebsite() {
  const fromWebsite =
    (await detectWebsiteLanguage()) ||
    (await detectWebsiteLanguageFromCookies());
  if (!fromWebsite || fromWebsite === currentLang) return;

  currentLang = fromWebsite;
  await chromeSet({ [EXT_LANG_KEY]: fromWebsite });
  applyStaticTranslations();
}

function startLanguageSyncLoop() {
  if (languageSyncTimer) return;
  languageSyncTimer = setInterval(() => {
    syncLanguageFromWebsite();
  }, LANG_SYNC_INTERVAL_MS);
}

function stopLanguageSyncLoop() {
  if (!languageSyncTimer) return;
  clearInterval(languageSyncTimer);
  languageSyncTimer = null;
}

function applyStaticTranslations() {
  document.documentElement.lang = currentLang;
  document.title = tr("appTitle");

  const setText = (selector, value) => {
    const el = $(selector);
    if (el) el.textContent = value;
  };
  const setAttr = (selector, name, value) => {
    const el = $(selector);
    if (el) el.setAttribute(name, value);
  };

  setText("#auth-brand", tr("auth.brand"));
  setText("#auth-tab-login", tr("auth.tabLogin"));
  setText("#auth-tab-register", tr("auth.tabRegister"));
  setText("#label-username", tr("auth.username"));
  setText("#label-email", tr("auth.email"));
  setText("#label-password", tr("auth.password"));
  setText("#label-confirm", tr("auth.confirmPassword"));

  setAttr("#input-username", "placeholder", tr("auth.usernamePlaceholder"));
  setAttr("#input-email", "placeholder", tr("auth.emailPlaceholder"));
  setAttr("#input-password", "placeholder", tr("auth.passwordPlaceholder"));
  setAttr("#input-confirm", "placeholder", tr("auth.confirmPlaceholder"));

  setText("#txt-new-chat", tr("sidebar.newChat"));
  setText("#txt-your-chats", tr("sidebar.yourChats"));
  setText("#txt-upload-image", tr("chat.uploadImage"));
  setText("#txt-internet-access", tr("chat.internetAccess"));
  setText("#txt-style-section", tr("chat.styleSection"));
  setText("#txt-style-formal", tr("chat.styleFormal"));
  setText("#txt-style-friendly", tr("chat.styleFriendly"));
  setText("#txt-style-precise", tr("chat.stylePrecise"));

  setAttr("#btn-close-sidebar", "title", tr("sidebar.closeMenu"));
  setAttr("#btn-toggle-sidebar", "title", tr("sidebar.openMenu"));
  setAttr("#btn-new-chat", "title", tr("sidebar.newChat"));
  setAttr("#btn-logout", "title", tr("sidebar.logout"));
  setAttr("#header-logo", "title", tr("sidebar.newChat"));
  setAttr("#btn-plus", "title", tr("chat.options"));
  setAttr("#btn-send", "title", tr("chat.send"));
  setAttr("#btn-stop", "title", tr("chat.stop"));
  setAttr("#chat-input", "placeholder", tr("chat.placeholder"));

  modelOptions.forEach((opt) => {
    opt.textContent = modelLabelFor(opt.dataset.model);
  });
  if (modelLabelEl) {
    modelLabelEl.textContent = modelLabelFor(selectedModel);
  }

  if (!chatListEl.querySelector(".chat-item")) {
    chatListEl.innerHTML = `<p class="no-chats">${tr("sidebar.noChats")}</p>`;
  }

  updateInternetToggleUI();

  setAuthMode(authMode);
  renderMessages();
}

const WEBSITE_SUMMARY_PROMPT_RE =
  /(webseite|website|seite|zusammenfass|wichtigste|hauptpunkte|zusammenfassung|summar(y|ize)|key\s*points)/i;

let token = null;
let user = null;
let currentChatId = null;
let messages = [];
let isSending = false;
let abortController = null;
let selectedModel = "qwen3-vl:2b-instruct";
let aiStyle = "formal";
let internetAccess = false;
let imageFile = null;
let imagePreview = null;
let sidebarOpen = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const authScreen = $("#auth-screen");
const chatScreen = $("#chat-screen");
const authTabs = $$(".auth-tab");
const authTitle = $("#auth-title");
const authSubtitle = $("#auth-subtitle");
const fieldUsername = $("#field-username");
const fieldConfirm = $("#field-confirm");
const inputUsername = $("#input-username");
const inputEmail = $("#input-email");
const inputPassword = $("#input-password");
const inputConfirm = $("#input-confirm");
const authError = $("#auth-error");
const authSubmit = $("#auth-submit");
const authSubmitTxt = $("#auth-submit-text");
const authSpinner = $("#auth-spinner");
const authSwitchTxt = $("#auth-switch-text");
const authSwitchLnk = $("#auth-switch-link");

const messagesArea = $("#messages-area");
const welcomeEl = $("#welcome-container");
const welcomeText = $("#welcome-text");
const chatInput = $("#chat-input");
const btnSend = $("#btn-send");
const btnStop = $("#btn-stop");
const btnPlus = $("#btn-plus");
const plusMenu = $("#plus-menu");
const btnUploadImg = $("#btn-upload-image");
const btnToggleInternet = $("#btn-toggle-internet");
const fileInput = $("#file-input");
const imgPreviewBar = $("#image-preview-bar");
const imgPreviewImg = $("#image-preview-img");
const imgPillName = $("#image-pill-name");
const btnRemoveImg = $("#btn-remove-image");
const btnModel = $("#btn-model");
const modelLabelEl = $("#model-label");
const modelDropdown = $("#model-dropdown");
const modelOptions = $$(".model-option");
const sidebar = $("#sidebar");
const sidebarOverlay = $("#sidebar-overlay");
const btnToggleSB = $("#btn-toggle-sidebar");
const btnCloseSB = $("#btn-close-sidebar");
const headerLogo = $("#header-logo");
const btnNewChat = $("#btn-new-chat");
const chatListEl = $("#chat-list");
const sidebarAvatar = $("#sidebar-avatar");
const sidebarName = $("#sidebar-name");
const sidebarPlan = $("#sidebar-plan");
const btnLogout = $("#btn-logout");

let authMode = "login";

function updateInternetToggleUI() {
  if (btnToggleInternet) {
    btnToggleInternet.classList.toggle("active-toggle", internetAccess);
    btnToggleInternet.setAttribute(
      "title",
      internetAccess ? tr("chat.internetOn") : tr("chat.internetOff"),
    );
  }
}

function initStarsBackground() {
  const c = document.getElementById("stars-canvas");
  if (!c) return;

  const ctx = c.getContext("2d");
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
  window.addEventListener("resize", resize);
  draw();

  window.addEventListener(
    "beforeunload",
    () => {
      window.removeEventListener("resize", resize);
      if (frame) cancelAnimationFrame(frame);
    },
    { once: true },
  );
}

async function init() {
  await loadLocales();
  currentLang = await resolveLanguage();
  applyStaticTranslations();
  await syncLanguageFromWebsite();
  startLanguageSyncLoop();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncLanguageFromWebsite();
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    syncLanguageFromWebsite();
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === "complete" || !!changeInfo.url) {
      syncLanguageFromWebsite();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[EXT_LANG_KEY]) return;
    const newLang = normalizeLang(changes[EXT_LANG_KEY].newValue);
    if (!newLang || newLang === currentLang) return;
    currentLang = newLang;
    applyStaticTranslations();
  });

  window.addEventListener(
    "beforeunload",
    () => {
      stopLanguageSyncLoop();
    },
    { once: true },
  );

  const welcomeMessages = trArray("welcomeMessages");
  welcomeText.textContent =
    welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];

  const stored = await chromeGet([TOKEN_KEY, USER_KEY, EXT_WEB_ACCESS_KEY]);
  token = stored[TOKEN_KEY] || getAuthCookie();
  user = stored[USER_KEY] || null;
  internetAccess = parseBoolean(stored[EXT_WEB_ACCESS_KEY]);
  updateInternetToggleUI();

  if (token) {
    if (!stored[TOKEN_KEY]) {
      await chromeSet({ [TOKEN_KEY]: token });
    }

    try {
      const res = await apiFetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        user = data.user;
        await chromeSet({ [USER_KEY]: user });
        setAuthCookie(token);
      } else if (res.status === 401 || res.status === 403) {
        await clearAuthSession();
      }
    } catch {
    }
  }

  if (token && user) {
    showChat();
  } else {
    showAuth();
  }
}

function chromeGet(keys) {
  return new Promise((r) => chrome.storage.local.get(keys, r));
}
function chromeSet(obj) {
  return new Promise((r) => chrome.storage.local.set(obj, r));
}
function chromeRemove(keys) {
  return new Promise((r) => chrome.storage.local.remove(keys, r));
}

async function clearAuthSession() {
  token = null;
  user = null;
  clearAuthCookie();
  await chromeRemove([TOKEN_KEY, USER_KEY]);
}

function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { ...opts, headers });
}

function showAuth() {
  authScreen.classList.remove("hidden");
  chatScreen.classList.add("hidden");
  setAuthMode("login");
}

function setAuthMode(mode) {
  authMode = mode;
  authTabs.forEach((t) =>
    t.classList.toggle("active", t.dataset.mode === mode),
  );
  fieldUsername.classList.toggle("hidden", mode === "login");
  fieldConfirm.classList.toggle("hidden", mode === "login");
  authError.classList.add("hidden");
  inputUsername.value = "";
  inputEmail.value = "";
  inputPassword.value = "";
  inputConfirm.value = "";

  if (mode === "login") {
    authTitle.textContent = tr("auth.titleLogin");
    authSubtitle.textContent = tr("auth.subtitleLogin");
    authSubmitTxt.textContent = tr("auth.submitLogin");
    authSwitchTxt.textContent = tr("auth.switchToRegisterText");
    authSwitchLnk.textContent = tr("auth.switchToRegisterLink");
  } else {
    authTitle.textContent = tr("auth.titleRegister");
    authSubtitle.textContent = tr("auth.subtitleRegister");
    authSubmitTxt.textContent = tr("auth.submitRegister");
    authSwitchTxt.textContent = tr("auth.switchToLoginText");
    authSwitchLnk.textContent = tr("auth.switchToLoginLink");
  }
}

authTabs.forEach((t) =>
  t.addEventListener("click", () => setAuthMode(t.dataset.mode)),
);
authSwitchLnk.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "login" ? "register" : "login");
});

authSubmit.addEventListener("click", handleAuth);
$("#auth-form").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAuth();
});

async function handleAuth() {
  const email = inputEmail.value.trim();
  const password = inputPassword.value;
  const username = inputUsername.value.trim();
  const confirm = inputConfirm.value;

  if (authMode === "register") {
    if (!username || !email || !password || !confirm)
      return showAuthError(tr("auth.errFillFields"));
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username))
      return showAuthError(tr("auth.errUsername"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return showAuthError(tr("auth.errInvalidEmail"));
    if (password.length < 8) return showAuthError(tr("auth.errPasswordLength"));
    if (password !== confirm)
      return showAuthError(tr("auth.errPasswordMismatch"));
  } else {
    if (!email || !password) return showAuthError(tr("auth.errFillFields"));
  }

  authSubmit.disabled = true;
  authSubmitTxt.classList.add("hidden");
  authSpinner.classList.remove("hidden");
  authError.classList.add("hidden");

  try {
    const endpoint =
      authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      authMode === "login"
        ? { email, password }
        : { username, email, password };

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) return showAuthError(data.error || tr("auth.errGeneric"));

    token = data.token;
    user = data.user;
    setAuthCookie(token);
    await chromeSet({ [TOKEN_KEY]: token, [USER_KEY]: user });
    showChat();
  } catch {
    showAuthError(tr("auth.errServer"));
  } finally {
    authSubmit.disabled = false;
    authSubmitTxt.classList.remove("hidden");
    authSpinner.classList.add("hidden");
  }
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove("hidden");
}

function showChat() {
  authScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : "??";
  sidebarAvatar.textContent = initials;
  sidebarName.textContent = user?.username ?? "—";
  sidebarPlan.textContent = user?.plan ?? "Free";

  updateModelForPlan();
  updateModelDropdown();

  loadChatList();

  handleNewChat();
}

function planRank(plan) {
  const p = (plan || "Free").toLowerCase();
  if (p === "admin" || p === "max") return 2;
  if (p === "pro") return 1;
  return 0;
}

function updateModelForPlan() {
  const rank = planRank(user?.plan);
  if (rank >= 2) selectedModel = "qwen3-vl:8b-instruct";
  else if (rank >= 1) selectedModel = "qwen3-vl:4b-instruct";
  else selectedModel = "qwen3-vl:2b-instruct";
  modelLabelEl.textContent = modelLabelFor(selectedModel);
}

function modelLabelFor(modelId) {
  return getModelLabel(modelId);
}

function updateModelDropdown() {
  const rank = planRank(user?.plan);
  modelOptions.forEach((opt) => {
    const model = MODELS.find((m) => m.id === opt.dataset.model);
    opt.classList.toggle("active", opt.dataset.model === selectedModel);
    opt.classList.toggle("locked", model && model.rank > rank);
  });
  if (modelLabelEl) {
    modelLabelEl.textContent = modelLabelFor(selectedModel);
  }
}

btnModel.addEventListener("click", () =>
  modelDropdown.classList.toggle("hidden"),
);
document.addEventListener("click", (e) => {
  if (!btnModel.contains(e.target) && !modelDropdown.contains(e.target))
    modelDropdown.classList.add("hidden");
});

modelOptions.forEach((opt) => {
  opt.addEventListener("click", () => {
    const model = MODELS.find((m) => m.id === opt.dataset.model);
    if (model && model.rank > planRank(user?.plan)) {
      toast(tr("chat.modelLocked"), "error");
      return;
    }
    selectedModel = opt.dataset.model;
    modelLabelEl.textContent = modelLabelFor(selectedModel);
    updateModelDropdown();
    modelDropdown.classList.add("hidden");
  });
});

btnToggleSB.addEventListener("click", () => toggleSidebar(!sidebarOpen));
btnCloseSB?.addEventListener("click", () => toggleSidebar(false));
sidebarOverlay.addEventListener("click", () => toggleSidebar(false));

function toggleSidebar(open) {
  sidebarOpen = open;
  sidebar.classList.toggle("open", open);
  sidebarOverlay.classList.toggle("hidden", !open);
  btnToggleSB.classList.toggle("sidebar-open", open);
  btnCloseSB?.classList.toggle("sidebar-open", open);
}

btnNewChat.addEventListener("click", () => {
  handleNewChat();
  toggleSidebar(false);
});

headerLogo?.addEventListener("click", (e) => {
  e.preventDefault();
  handleNewChat();
  toggleSidebar(false);
});

btnLogout.addEventListener("click", async () => {
  await clearAuthSession();
  showAuth();
});

async function loadChatList() {
  try {
    const res = await apiFetch("/api/history");
    if (!res.ok) return;
    const data = await res.json();
    const chats = Array.isArray(data) ? data : data.chats || [];
    renderChatList(chats);
  } catch (e) {
    console.error("loadChatList error:", e);
  }
}

function renderChatList(chats) {
  if (!chats.length) {
    chatListEl.innerHTML = `<p class="no-chats">${tr("sidebar.noChats")}</p>`;
    return;
  }
  chatListEl.innerHTML = "";
  chats.forEach((chat) => {
    const div = document.createElement("div");
    div.className = `chat-item${chat.filename === currentChatId ? " active" : ""}`;
    div.innerHTML = `
      <span class="chat-item-name">${escapeHtml(chat.preview || chat.title || "Chat")}</span>
      <button class="chat-item-delete" title="${tr("chat.delete")}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>`;
    div.querySelector(".chat-item-name").addEventListener("click", () => {
      loadChat(chat.filename);
      toggleSidebar(false);
    });
    div.querySelector(".chat-item-delete").addEventListener("click", (e) => {
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
      isUser: m.role === "user",
      id: `loaded-${i}-${uid()}`,
    }));
    currentChatId = filename;
    renderMessages();
    loadChatList();
  } catch (e) {
    console.error("loadChat error:", e);
  }
}

async function deleteChat(filename) {
  try {
    const res = await apiFetch(`/api/history/${filename}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (currentChatId === filename) handleNewChat();
      loadChatList();
    }
  } catch (e) {
    console.error("deleteChat error:", e);
  }
}

function handleNewChat() {
  if (abortController) abortController.abort();
  messages = [];
  currentChatId = null;
  isSending = false;
  chatInput.value = "";
  clearImage();
  renderMessages();
  chatInput.focus();
}

btnPlus.addEventListener("click", (e) => {
  e.stopPropagation();
  plusMenu.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!plusMenu.contains(e.target) && !btnPlus.contains(e.target))
    plusMenu.classList.add("hidden");
});

btnUploadImg.addEventListener("click", () => {
  fileInput.click();
  plusMenu.classList.add("hidden");
});

btnToggleInternet?.addEventListener("click", async () => {
  internetAccess = !internetAccess;
  updateInternetToggleUI();
  await chromeSet({ [EXT_WEB_ACCESS_KEY]: internetAccess });
});

$$(".plus-menu-item[data-style]").forEach((btn) => {
  btn.addEventListener("click", () => {
    aiStyle = btn.dataset.style;
    $$(".plus-menu-item[data-style]").forEach((b) =>
      b.classList.remove("active-style"),
    );
    btn.classList.add("active-style");
    plusMenu.classList.add("hidden");
  });
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast(tr("chat.onlyImages"), "error");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast(tr("chat.imageTooLarge", { max: 10 }), "error");
    return;
  }
  imageFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    imagePreview = ev.target.result;
    imgPreviewImg.src = imagePreview;
    imgPillName.textContent = file.name;
    imgPreviewBar.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

btnRemoveImg.addEventListener("click", clearImage);

function clearImage() {
  imageFile = null;
  imagePreview = null;
  imgPreviewBar.classList.add("hidden");
  imgPreviewImg.src = "";
  fileInput.value = "";
}

function shouldAttachWebsiteContext(text = "") {
  return WEBSITE_SUMMARY_PROMPT_RE.test(text);
}

function buildWebsiteContextPrompt(page) {
  const title = (page?.title || "").trim();
  const url = (page?.url || "").trim();
  const content = (page?.content || "").trim();
  if (!content) return "";
  return [
    "",
    tr("chat.ctxIntro"),
    tr("chat.ctxTitle", { value: title || tr("chat.unknown") }),
    tr("chat.ctxUrl", { value: url || tr("chat.unknown") }),
    tr("chat.ctxContent"),
    content,
  ].join("\n");
}

async function getActivePageContext() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url) return null;
    if (/^(chrome|chrome-extension|edge|about|view-source):/i.test(tab.url))
      return null;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const root =
          document.querySelector('main, article, [role="main"]') ||
          document.body;
        const title = document.title || "";
        const url = location.href || "";

        const chunks = [];
        const headingNodes = root.querySelectorAll("h1, h2, h3");
        for (const node of headingNodes) {
          const t = (node.textContent || "").trim();
          if (t) chunks.push(t);
          if (chunks.length >= 80) break;
        }

        const textNodes = root.querySelectorAll("p, li");
        for (const node of textNodes) {
          const t = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (t && t.length > 25) chunks.push(t);
          if (chunks.length >= 280) break;
        }

        let content = chunks.join("\n");
        content = content
          .replace(/\s+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (content.length > 12000) content = content.slice(0, 12000);

        return { title, url, content };
      },
    });

    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

chatInput.addEventListener("input", () => {
  btnSend.disabled = !chatInput.value.trim() && !imagePreview;
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !isSending) {
    e.preventDefault();
    sendMessage();
  }
});

btnSend.addEventListener("click", sendMessage);
btnStop.addEventListener("click", () => abortController?.abort());

async function sendMessage() {
  const text =
    chatInput.value.trim() || (imageFile ? tr("chat.describeImage") : "");
  if (!text || isSending) return;

  isSending = true;
  chatInput.value = "";
  chatInput.style.height = "auto";
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");
  btnSend.disabled = true;

  let imageUrl = null;
  const fileCopy = imageFile;
  let requestText = text;

  if (shouldAttachWebsiteContext(text)) {
    const page = await getActivePageContext();
    const pageBlock = buildWebsiteContextPrompt(page);
    if (pageBlock) requestText = `${text}${pageBlock}`;
    else toast(tr("chat.readPageFailed"), "error");
  }

  if (fileCopy) {
    try {
      const fd = new FormData();
      fd.append("image", fileCopy);
      const upRes = await apiFetch("/api/history/upload-image", {
        method: "POST",
        body: fd,
      });
      if (!upRes.ok) {
        const errorPayload = await upRes.json().catch(() => ({}));
        throw new Error(
          errorPayload.error || `Upload failed (${upRes.status})`,
        );
      }

      const upData = await upRes.json();
      imageUrl = normalizeHistoryImagePath(upData?.url);
      if (!imageUrl) throw new Error("Invalid upload response URL");

      clearImage();
    } catch (err) {
      console.error("Image upload failed:", err);
      toast(tr("chat.imageUploadFailed"), "error");

      isSending = false;
      btnStop.classList.add("hidden");
      btnSend.classList.remove("hidden");

      chatInput.value = text;
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
      btnSend.disabled = !chatInput.value.trim() && !imagePreview;
      return;
    }
  }

  const userContent = imageUrl
    ? `![${tr("chat.image")}](${imageUrl})\n\n${text}`
    : text;
  const userMsg = { content: userContent, isUser: true, id: uid() };
  messages.push(userMsg);
  renderMessages();
  scrollToBottom();

  const context = messages.slice(0, -1).map((m) => ({
    role: m.isUser ? "user" : "assistant",
    content: toContextContent(m.content),
  }));

  const aiId = uid();
  messages.push({ content: "", isUser: false, id: aiId });
  renderMessages();
  scrollToBottom();

  abortController = new AbortController();
  let fullText = "";

  try {
    const fd = new FormData();
    fd.append("message", requestText);
    fd.append("context", JSON.stringify(context));
    fd.append("model", selectedModel);
    fd.append("aiStyle", aiStyle);
    fd.append("internetAccess", internetAccess ? "true" : "false");
    if (fileCopy) fd.append("image", fileCopy);

    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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

    const isNew =
      !currentChatId && messages.filter((m) => m.isUser).length === 1;
    await saveChat(isNew);
    loadChatList();
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Stream error:", err);
      updateMessage(aiId, fullText || tr("chat.streamError"));
    } else if (fullText) {
      updateMessage(aiId, fullText);
      await saveChat(false);
      loadChatList();
    }
  } finally {
    abortController = null;
    isSending = false;
    btnStop.classList.add("hidden");
    btnSend.classList.remove("hidden");
    btnSend.disabled = !chatInput.value.trim();
  }
}

function updateMessage(id, content) {
  const msg = messages.find((m) => m.id === id);
  if (msg) msg.content = content;
  const el = document.querySelector(`[data-msg-id="${id}"] .message-bubble`);
  if (el) el.innerHTML = content ? renderMarkdown(content) : typingLoaderHTML();
}

async function saveChat(generateTitle = false) {
  try {
    await apiFetch("/api/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          role: m.isUser ? "user" : "assistant",
          content: m.content,
        })),
        filename: currentChatId || undefined,
        generateTitle,
      }),
    }).then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (data.filename && !currentChatId) currentChatId = data.filename;
      }
    });
  } catch (e) {
    console.error("saveChat error:", e);
  }
}

function renderMessages() {
  messagesArea.innerHTML = "";

  if (messages.length === 0) {
    const welcomeMessages = trArray("welcomeMessages");
    messagesArea.innerHTML = `
      <div class="welcome-container">
        <span class="welcome-text">${welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]}</span>
      </div>`;
    return;
  }

  messages.forEach((msg, idx) => {
    messagesArea.appendChild(createMessageEl(msg, idx));
  });
  scrollToBottom();
}

function createMessageEl(msg, idx) {
  const div = document.createElement("div");
  div.className = `message ${msg.isUser ? "user-message" : "ai-message"}`;
  div.dataset.msgId = msg.id;

  const imageUrl = extractImageUrl(msg.content);
  const textOnly = stripImg(msg.content);

  let bubbleHTML = "";
  if (msg.isUser) {
    if (imageUrl) {
      const imageSrc = resolveImageSrc(imageUrl);
      if (imageSrc) {
        bubbleHTML += `<img class="message-image" src="${imageSrc}" alt="${tr("chat.imageAlt")}"/>`;
      }
    }
    bubbleHTML += escapeHtml(textOnly);
  } else {
    bubbleHTML = msg.content ? renderMarkdown(msg.content) : typingLoaderHTML();
  }

  div.innerHTML = `
    <div class="message-bubble">${bubbleHTML}</div>
    <div class="message-actions">
      ${
        !msg.isUser && msg.content
          ? `
        <button class="msg-action-btn" data-action="regenerate" title="${tr("chat.regenerate")}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
        </button>`
          : ""
      }
      <button class="msg-action-btn" data-action="copy" title="${tr("chat.copy")}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
    </div>`;

  div.querySelectorAll(".msg-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "copy") {
        navigator.clipboard.writeText(stripImg(msg.content));
        toast(tr("chat.copied"), "success");
      } else if (btn.dataset.action === "regenerate") {
        regenerate();
      }
    });
  });

  return div;
}

async function regenerate() {
  if (isSending || !messages.length) return;
  const aiIdx = messages.reduceRight(
    (f, m, i) => (f === -1 && !m.isUser ? i : f),
    -1,
  );
  if (aiIdx === -1) return;
  const uIdx = messages
    .slice(0, aiIdx)
    .reduceRight((f, m, i) => (f === -1 && m.isUser ? i : f), -1);
  if (uIdx === -1) return;

  const userMsg = messages[uIdx];
  messages = messages.slice(0, aiIdx);
  renderMessages();

  isSending = true;
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");
  abortController = new AbortController();

  const aiId = uid();
  messages.push({ content: "", isUser: false, id: aiId });
  renderMessages();

  const context = messages.slice(0, -1).map((m) => ({
    role: m.isUser ? "user" : "assistant",
    content: toContextContent(m.content),
  }));

  let fullText = "";
  try {
    const fd = new FormData();
    let requestText = toContextContent(userMsg.content);
    if (shouldAttachWebsiteContext(requestText)) {
      const page = await getActivePageContext();
      const pageBlock = buildWebsiteContextPrompt(page);
      if (pageBlock) requestText = `${requestText}${pageBlock}`;
    }

    fd.append("message", requestText);
    fd.append("context", JSON.stringify(context.slice(0, -1)));
    fd.append("model", selectedModel);
    fd.append("aiStyle", aiStyle);
    fd.append("internetAccess", internetAccess ? "true" : "false");

    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    if (err.name !== "AbortError") {
      updateMessage(aiId, fullText || tr("chat.shortError"));
    }
  } finally {
    abortController = null;
    isSending = false;
    btnStop.classList.add("hidden");
    btnSend.classList.remove("hidden");
  }
}

function renderMarkdown(raw = "") {
  let html = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`,
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.*?)\*\*/gs, "<strong>$1</strong>")
    .replace(/__(.*?)__/gs, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gs, "<em>$1</em>")
    .replace(/_(.*?)_/gs, "<em>$1</em>")
    .replace(
      /\[(.*?)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    )
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br/>");

  html = html.replace(/((?:<li>.*?<\/li>(?:<br\/>)?)+)/g, "<ul>$1</ul>");
  html = html.replace(
    /<ul>(.*?)<\/ul>/gs,
    (_, inner) => "<ul>" + inner.replace(/<br\/>/g, "") + "</ul>",
  );

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

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function stripImg(text = "") {
  return text.replace(/!\[.*?\]\([^)]+\)\n\n?/g, "").trim();
}

function toContextContent(text = "") {
  return String(text || "")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (full, rawUrl) => {
      const url = String(rawUrl || "").trim();
      return /\/history\/images\//.test(url) ? full : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractImageUrl(content = "") {
  const m = content.match(/!\[.*?\]\(([^)]+)\)/);
  return m ? m[1] : null;
}

function normalizeHistoryImagePath(rawUrl = "") {
  const value = String(rawUrl || "").trim();
  if (!value) return null;

  if (/^(https?:|data:)/i.test(value)) return value;
  if (value.startsWith("/history/images/")) return value;
  if (value.startsWith("history/images/")) return `/${value}`;

  const serverMarker = "/server/history/images/";
  const markerIndex = value.indexOf(serverMarker);
  if (markerIndex >= 0) {
    const filename = value
      .slice(markerIndex + serverMarker.length)
      .replace(/^\/+/, "");
    return filename ? `/history/images/${filename}` : null;
  }

  const historyMarker = "/history/images/";
  const historyIndex = value.indexOf(historyMarker);
  if (historyIndex >= 0) {
    return value.slice(historyIndex);
  }

  return value.startsWith("/") ? value : `/${value}`;
}

function resolveImageSrc(rawUrl = "") {
  const normalized = normalizeHistoryImagePath(rawUrl);
  if (!normalized) return null;
  if (/^(https?:|data:)/i.test(normalized)) return normalized;
  return `${API_BASE}${normalized}`;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  });
}

function toast(msg, type = "error") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

initStarsBackground();
init();
