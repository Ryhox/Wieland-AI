const API_BASE = "http://localhost:3001";

// extension config: API server, storage keys, UI timing constants, supported languages
const EXT_LANG_KEY = "wieland_lang";
const TOKEN_KEY = "wieland_token";
const USER_KEY = "wieland_user";
const EXT_WEB_ACCESS_KEY = "wieland_ext_internet_access";
const AUTH_COOKIE_KEY = "wieland_ext_token";
const WEBSITE_LANG_COOKIE_KEY = "wieland_lang";
const MAIN_WEBSITE_HOSTS = ["localhost", "127.0.0.1"];
const LANG_SYNC_INTERVAL_MS = 1500;
const MODEL_PRELOAD_REFRESH_MS = 10 * 60 * 1000;
const CLARIFY_POPUP_DELAY_MS = 0;
const CLARIFY_TYPE_INTERVAL_MS = 18;
const CLARIFY_QUESTION_CHARS_PER_TICK = 1;
const CLARIFY_OPTION_CHARS_PER_TICK = 1;
const SUPPORTED_LANGS = ["de", "en", "it"];
const I18N = Object.fromEntries(SUPPORTED_LANGS.map((lang) => [lang, {}]));
let localesLoaded = false;

// Alle i18n Files (de, en, it) parallel laden
async function loadLocales() {
  if (localesLoaded) return;

  // Promise.all für paralleles Fetchen statt wartend
  const results = await Promise.all(
    SUPPORTED_LANGS.map(async (lang) => {
      try {
        // Chrome Ext oder fallback zu lokalem Pfad
        const url = chrome?.runtime?.getURL
          ? chrome.runtime.getURL(`locales/${lang}.json`)
          : `locales/${lang}.json`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return [lang, json];
      } catch (error) {
        // Bei Error einfach leeres dict, Fallback funktioniert dann
        console.error(`Failed to load locale '${lang}'`, error);
        return [lang, {}];
      }
    }),
  );

  // Alle geladen Locales ins globale I18N mergen
  for (const [lang, dict] of results) {
    I18N[lang] = dict;
  }

  localesLoaded = true;
}

let currentLang = "de";
let languageSyncTimer = null;

// language: normalisieren zu 2-char code (de/en/it) oder null
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

// Übersetzung mit Fallback: aktuelle Lang > Deutsch > Raw Key
function tr(key, vars = {}) {
  const lookup = (obj) =>
    key.split(".").reduce((acc, part) => acc?.[part], obj);
  const fromLang = lookup(I18N[currentLang]);
  const fromDe = lookup(I18N.de);
  // Fallback chain: erst lang, dann deutsch, sonst key als-is
  const template =
    typeof fromLang === "string"
      ? fromLang
      : typeof fromDe === "string"
        ? fromDe
        : key;
  // Platzhalter wie {foo} ersetzen mit Werten aus vars
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
  { id: "qwen3-vl:4b-instruct", key: "chat.models.free", rank: 0 },
  { id: "qwen3-vl:8b-instruct", key: "chat.models.pro", rank: 1 },
  { id: "qwen3-vl:8b-instruct-max", key: "chat.models.max", rank: 2 },
];

function getModelLabel(modelId) {
  const model = MODELS.find((m) => m.id === modelId);
  if (!model) return modelId;
  // fallback label while locales loading
  const fallbacks = {
    "qwen3-vl:4b-instruct": "Dwarf",
    "qwen3-vl:8b-instruct": "Star",
    "qwen3-vl:8b-instruct-max": "Supergiant",
  };
  if (!localesLoaded) return fallbacks[modelId] || modelId;
  return tr(model.key);
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
  updateLegalLabels();
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
  // UI labels: nutze tr() helper um HTML elemente automatisch zu übersetzen
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
  updateMainInputPlaceholder();
  updateInputIconState();
  updateModelButtonState();

  setAuthMode(authMode);
  renderMessages();
}

const WEBSITE_SUMMARY_PROMPT_RE =
  /(webseite|website|seite|zusammenfass|wichtigste|hauptpunkte|zusammenfassung|summar(y|ize)|key\s*points)/i;
const PAGE_REFERENCE_PROMPT_RE =
  /(auf\s+(dieser|der)\s+seite|auf\s+(dieser|der)\s+webseite|hier\s+auf\s+der\s+seite|auf\s+dem\s+artikel|on\s+(this|the)\s+page|on\s+this\s+website|in\s+this\s+article|su\s+questa\s+pagina|in\s+questo\s+articolo)/i;
const FACT_QUESTION_PROMPT_RE =
  /\b(wann|when|quando|wo|where|dove|wer|who|chi|was|what|che)\b/i;
const CLARIFY_JSON_BLOCK_RE =
  /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]([\s\S]*?)\[\[\s*\/\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_OPTION_LINE_RE = /^\s*([A-E])[)\].:-]\s*(.+)$/i;
const CLARIFY_OPTION_IDS = ["A", "B", "C", "D", "E"];
const STATUS_STREAM_EVENT_START = "\u0002WIELAND_STATUS:";
const STATUS_STREAM_EVENT_END = "\u0003";
const POPUP_IDEA_PLACEHOLDER_BY_LANG = {
  de: "Beschreibe deine Idee",
  en: "Describe your idea",
  it: "Descrivi la tua idea",
};
const POPUP_SKIP_LABEL_BY_LANG = {
  de: "Überspringen",
  en: "Skip",
  it: "Salta",
};
const CONTEXT_MATCH_STOPWORDS = new Set([
  "und",
  "oder",
  "der",
  "die",
  "das",
  "ein",
  "eine",
  "einer",
  "einem",
  "den",
  "dem",
  "des",
  "auf",
  "mit",
  "von",
  "ist",
  "war",
  "wurde",
  "wann",
  "wer",
  "wo",
  "was",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "when",
  "where",
  "who",
  "what",
  "how",
  "was",
  "is",
  "are",
  "di",
  "del",
  "della",
  "delle",
  "dei",
  "degli",
  "dello",
  "che",
  "chi",
  "quando",
  "dove",
  "con",
  "per",
  "una",
  "uno",
  "un",
  "il",
  "la",
  "lo",
]);

function normalizeClarifyOptions(rawOptions = []) {
  const out = [];
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  const seenLabelKeys = new Set();

  const normalizeClarifyLabelKey = (value = "") =>
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const isDisallowedClarifyOptionLabel = (value = "") => {
    const labelKey = normalizeClarifyLabelKey(value);
    if (!labelKey) return true;

    return (
      /^(other|others|something else|anything else|custom|free text|explain|explanation|more details?|details?)$/.test(
        labelKey,
      ) ||
      /^(etwas anderes|anderes|sonstiges|freitext|eigene angabe|eigene eingabe|erklaren|erklaeren|erklarung)$/.test(
        labelKey,
      ) ||
      /^(altro|qualcos altro|spiega|spiegami)$/.test(labelKey)
    );
  };

  for (const item of list) {
    if (out.length >= 5) break;

    let id = "";
    let label = "";

    if (typeof item === "string") {
      label = item.trim();
      id = CLARIFY_OPTION_IDS[out.length] || "";
    } else {
      id = String(item?.id || item?.key || "")
        .trim()
        .toUpperCase();
      label = String(item?.label || item?.text || item?.value || "").trim();
    }

    if (!label) continue;
    if (isDisallowedClarifyOptionLabel(label)) continue;
    if (!/^[A-E]$/.test(id)) id = CLARIFY_OPTION_IDS[out.length] || "";
    if (!id) continue;

    const labelKey = normalizeClarifyLabelKey(label);
    if (labelKey && seenLabelKeys.has(labelKey)) continue;
    if (labelKey) seenLabelKeys.add(labelKey);

    out.push({ id, label });
  }

  return out;
}

function toSingleSentenceQuestion(value = "", fallback = "") {
  // clarify popup: erste satz aus response extrahieren, max 140 chars
  const source = String(value || fallback || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return "";

  const sentenceMatch = source.match(/^[^.!?]+[.!?]?/);
  let question = sentenceMatch ? sentenceMatch[0].trim() : source;

  if (question.length > 140) {
    question = `${question.slice(0, 137).trimEnd()}...`;
  }

  return question;
}

function getClarifyPayloadSignature(payload = null) {
  if (!payload || typeof payload !== "object") return "";

  const options = Array.isArray(payload.options) ? payload.options : [];
  return JSON.stringify({
    question: String(payload.question || "").trim(),
    options: options.map((option) => ({
      id: String(option?.id || "")
        .trim()
        .toUpperCase(),
      label: String(option?.label || "").trim(),
    })),
    step: Number(payload.step) || null,
    totalSteps: Number(payload.totalSteps) || null,
  });
}

function isClarifyQaReplyText(value = "") {
  const source = String(value || "").trim();
  if (!source) return false;

  return /^q\s*:/i.test(source) && /(?:^|\n)\s*a\s*:/im.test(source);
}

// helper: format clarification reply (Q&A format) wenn user selected option dari popup
// returns raw answer wenn bereits formatted, otherwise "Q: ...\nA: ..." pair
function formatClarifyReply(question = "", answer = "") {
  const cleanAnswer = String(answer || "").trim();
  if (!cleanAnswer) return "";
  if (isClarifyQaReplyText(cleanAnswer)) return cleanAnswer;

  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) return cleanAnswer;

  return `Q: ${cleanQuestion}\nA: ${cleanAnswer}`;
}

function extractFirstJsonObject(rawText = "") {
  const source = String(rawText || "");
  const start = source.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return "";
}

function parseClarifyJsonObject(rawText = "") {
  const source = String(rawText || "").trim();
  if (!source) return null;

  const fencedMatch = source.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const normalized = (fencedMatch ? fencedMatch[1] : source).trim();

  try {
    return JSON.parse(normalized);
  } catch {}

  const jsonObject = extractFirstJsonObject(normalized);
  if (!jsonObject) return null;

  try {
    return JSON.parse(jsonObject);
  } catch {
    return null;
  }
}

function sanitizeClarifyPayload(payload = {}, fallbackQuestion = "") {
  const question = toSingleSentenceQuestion(
    payload?.question || payload?.title || "",
    fallbackQuestion,
  );
  const options = normalizeClarifyOptions(payload?.options || payload?.choices);
  if (!question || options.length < 2) return null;

  const rawStep = Number(payload?.step);
  const rawTotal = Number(payload?.totalSteps || payload?.total);
  const hasSingleStepMeta =
    Number.isFinite(rawStep) &&
    Number.isFinite(rawTotal) &&
    rawStep > 0 &&
    rawTotal > 0 &&
    rawTotal <= 1;

  return {
    question,
    options,
    allowFreeform: payload?.allowFreeform !== false,
    freeformPlaceholder: String(
      payload?.freeformPlaceholder || payload?.freeTextPlaceholder || "",
    ).trim(),
    skipLabel:
      String(payload?.skipLabel || "Überspringen").trim() || "Überspringen",
    step: hasSingleStepMeta ? 1 : null,
    totalSteps: hasSingleStepMeta ? 1 : null,
  };
}

function parsePlainTextClarificationFallback(rawText = "") {
  const source = String(rawText || "").trim();
  if (!source) return null;

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const options = [];
  let firstOptionIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(CLARIFY_OPTION_LINE_RE);
    if (!match) continue;
    if (firstOptionIndex < 0) firstOptionIndex = i;
    options.push({ id: match[1].toUpperCase(), label: match[2].trim() });
  }

  if (options.length < 2 || firstOptionIndex < 0) return null;

  const question =
    lines.slice(0, firstOptionIndex).join(" ").trim() || lines[0];
  const payload = sanitizeClarifyPayload({ question, options }, question);
  if (!payload) return null;

  const keptLines = lines.filter((line) => !CLARIFY_OPTION_LINE_RE.test(line));
  const cleanedText = keptLines.join("\n").trim() || payload.question;
  return { payload, cleanedText };
}

// JSON-Block oder Plain-Text Clarify-Payloads parsen aus AI Response
// extract clarification JSON payload aus AI response (suche [[WIELAND_CLARIFY_JSON]] markers)
// fallback zu plain-text format "Q: ... A: ... A) ... B) ..."
function extractClarificationPayload(rawText = "") {
  const source = String(rawText || "");
  if (!source) return { payload: null, cleanedText: "" };

  // First look for [[WIELAND_CLARIFY_JSON]] block marker
  const blockPattern = new RegExp(CLARIFY_JSON_BLOCK_RE.source, "gi");
  const blockMatches = [...source.matchAll(blockPattern)];
  if (blockMatches.length) {
    // remove JSON blocks from text (keep plain text fallback)
    const withoutBlocks = source
      .replace(new RegExp(CLARIFY_JSON_BLOCK_RE.source, "gi"), "")
      .trim();
    const fallbackQuestion = withoutBlocks.split(/\r?\n/).find(Boolean) || "";

    // reverse iterate: newest payload wins (last one in response)
    for (let i = blockMatches.length - 1; i >= 0; i--) {
      const parsed = parseClarifyJsonObject(blockMatches[i]?.[1] || "");
      const payload = sanitizeClarifyPayload(parsed || {}, fallbackQuestion);
      if (!payload) continue;

      return {
        payload,
        cleanedText: withoutBlocks || payload.question,
      };
    }

    return {
      payload: null,
      cleanedText: withoutBlocks || source.trim(),
    };
  }

  // Fallback zu Plain-Text parsing (older format)

  // Fallback zu Plain-Text parsing (older format)
  const fallback = parsePlainTextClarificationFallback(source);
  if (fallback) return fallback;

  return {
    payload: null,
    cleanedText: source.trim(),
  };
}

function getClarificationStreamPreview(rawText = "") {
  const source = String(rawText || "");
  if (!source) return { text: "", suppress: false };

  const markerMatch = source.match(
    /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i,
  );
  if (
    markerMatch &&
    Number.isInteger(markerMatch.index) &&
    markerMatch.index >= 0
  ) {
    return {
      text: source.slice(0, markerMatch.index).trimEnd(),
      suppress: true,
    };
  }

  const lines = source.split(/\r?\n/);
  const firstOptionIndex = lines.findIndex((line) =>
    CLARIFY_OPTION_LINE_RE.test(line),
  );
  if (firstOptionIndex >= 0) {
    return {
      text: lines.slice(0, firstOptionIndex).join("\n").trimEnd(),
      suppress: true,
    };
  }

  return { text: source, suppress: false };
}

function extractStatusEventsFromChunk(rawChunk = "", carry = "") {
  const source = `${String(carry || "")}${String(rawChunk || "")}`;
  if (!source) return { cleanText: "", events: [], carry: "" };

  const events = [];
  let cleanText = "";
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(STATUS_STREAM_EVENT_START, cursor);
    if (start < 0) {
      cleanText += source.slice(cursor);
      return { cleanText, events, carry: "" };
    }

    cleanText += source.slice(cursor, start);
    const payloadStart = start + STATUS_STREAM_EVENT_START.length;
    const end = source.indexOf(STATUS_STREAM_EVENT_END, payloadStart);

    if (end < 0) {
      return {
        cleanText,
        events,
        carry: source.slice(start),
      };
    }

    const payloadRaw = source.slice(payloadStart, end);
    let parsed = null;
    try {
      parsed = JSON.parse(payloadRaw);
    } catch {}

    if (parsed?.__wieland_status === true && parsed?.type) {
      events.push(parsed);
    } else {
      cleanText += source.slice(start, end + STATUS_STREAM_EVENT_END.length);
    }

    cursor = end + STATUS_STREAM_EVENT_END.length;
  }

  return { cleanText, events, carry: "" };
}

function getActivitySourceHost(rawUrl = "") {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  try {
    const host = new URL(value).hostname || "";
    return host.replace(/^www\./i, "");
  } catch {
    return value;
  }
}

let token = null;
let user = null;
let currentChatId = null;
let messages = [];
let isSending = false;
let abortController = null;
let selectedModel = "qwen3-vl:2b-instruct";
let aiStyle = "formal";
let internetAccess = true;
let lastPointerPosition = { x: null, y: null };
const TOAST_LIFETIME_MS = 3000;
const TOAST_FADE_DURATION_MS = 340;
const TOAST_VIEWPORT_MARGIN = 16;
const TOAST_POINTER_OFFSET_X = 18;
const TOAST_POINTER_OFFSET_Y = 0;
const TOAST_ESTIMATED_WIDTH = 340;
let imageFile = null;
let imagePreview = null;
let sidebarOpen = false;
let pendingClarifyReply = false;
let clarifyPopupTimer = null;
let activeClarifyPopup = null;
let activeClarifyPopupSignature = "";
let clarifyTypewriterTimer = null;
let clarifyTypewriterState = {
  questionLength: 0,
  shownOptions: 0,
  optionLengths: [],
};
const modelWarmUntil = new Map();

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

// Legal Modal Elements
const btnLegal = $("#btn-legal");
const legalLabel = $("#legal-label");
const legalModal = $("#legal-modal");
const legalModalOverlay = $("#legal-modal");
const legalModalClose = $("#legal-modal-close");
const legalModalTitle = $("#legal-modal-title");
const legalOptionNotice = $("#legal-option-notice");
const legalOptionPrivacy = $("#legal-option-privacy");
const legalOptionTerms = $("#legal-option-terms");
const legalOptions = $$(".legal-modal-link");

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
const clarifyPopup = $("#clarify-popup");
const clarifyPopupQuestion = $("#clarify-popup-question");
const clarifyPopupStep = $("#clarify-popup-step");
const clarifyPopupOptions = $("#clarify-popup-options");

let authMode = "login";

// check ob clarify popup DOM element visible (nicht hidden class)
function isClarifyPopupOpen() {
  return !!clarifyPopup && !clarifyPopup.classList.contains("hidden");
}

function getLocalizedIdeaPlaceholder() {
  return (
    POPUP_IDEA_PLACEHOLDER_BY_LANG[currentLang] ||
    POPUP_IDEA_PLACEHOLDER_BY_LANG.de
  );
}

function getLocalizedSkipLabel() {
  return POPUP_SKIP_LABEL_BY_LANG[currentLang] || POPUP_SKIP_LABEL_BY_LANG.de;
}

function getClarifyInputPlaceholder() {
  return (
    activeClarifyPopup?.freeformPlaceholder || getLocalizedIdeaPlaceholder()
  );
}

function buildLocalClarifyFallbackPayload(sourceText = "") {
  const lang = ["de", "en", "it"].includes(currentLang) ? currentLang : "de";
  const text = String(sourceText || "").trim();

  const byLang = {
    de: {
      question: "Kurze Rückfrage: Was möchtest du genau erstellen?",
      options: [
        { id: "A", label: "Landingpage" },
        { id: "B", label: "Komplette Website" },
        { id: "C", label: "Web-App" },
        { id: "D", label: "Browser-Erweiterung" },
      ],
      freeformPlaceholder: "Beschreibe deine Idee",
      skipLabel: "Überspringen",
    },
    en: {
      question: "Quick follow-up: What exactly do you want to build?",
      options: [
        { id: "A", label: "Landing page" },
        { id: "B", label: "Full website" },
        { id: "C", label: "Web app" },
        { id: "D", label: "Browser extension" },
      ],
      freeformPlaceholder: "Describe your idea",
      skipLabel: "Skip",
    },
    it: {
      question: "Domanda veloce: cosa vuoi creare esattamente?",
      options: [
        { id: "A", label: "Landing page" },
        { id: "B", label: "Sito completo" },
        { id: "C", label: "Web app" },
        { id: "D", label: "Estensione browser" },
      ],
      freeformPlaceholder: "Descrivi la tua idea",
      skipLabel: "Salta",
    },
  };

  const base = byLang[lang] || byLang.de;
  const refinedQuestion = text
    ? toSingleSentenceQuestion(text, base.question)
    : base.question;

  return sanitizeClarifyPayload(
    {
      question: refinedQuestion,
      options: base.options,
      allowFreeform: true,
      freeformPlaceholder: base.freeformPlaceholder,
      skipLabel: base.skipLabel,
      step: 1,
      totalSteps: 1,
    },
    base.question,
  );
}

// apply AI style selection: toggle button state + store selection
function applyAiStyleSelection(styleId = "") {
  const styleButtons = [...$$(".plus-menu-item[data-style]")];
  if (!styleButtons.length) {
    // fallback: no buttons found, just store the style
    aiStyle = String(styleId || aiStyle || "formal").trim() || "formal";
    return aiStyle;
  }

  const requestedStyle = String(styleId || aiStyle || "").trim();
  const firstStyle = String(styleButtons[0]?.dataset?.style || "formal");
  // validate style exists, fallback to first available
  const resolvedStyle = styleButtons.some(
    (btn) => btn.dataset.style === requestedStyle,
  )
    ? requestedStyle
    : firstStyle;

  // update global state + toggle active class on buttons
  aiStyle = resolvedStyle;
  styleButtons.forEach((btn) => {
    btn.classList.toggle("active-style", btn.dataset.style === resolvedStyle);
  });

  return resolvedStyle;
}

function updateMainInputPlaceholder() {
  if (!chatInput) return;
  chatInput.placeholder = isClarifyPopupOpen()
    ? getClarifyInputPlaceholder()
    : tr("chat.placeholder");
}

function updateInputIconState() {
  if (!btnPlus) return;
  const popupMode = isClarifyPopupOpen();
  btnPlus.classList.toggle("input-icon-popup-mode", popupMode);
  btnPlus.disabled = popupMode;
  btnPlus.title = popupMode
    ? getLocalizedIdeaPlaceholder()
    : tr("chat.options");
}

function updateModelButtonState() {
  if (!btnModel || !modelLabelEl) return;

  if (isClarifyPopupOpen()) {
    btnModel.classList.add("clarify-skip-mode");
    modelLabelEl.textContent = getLocalizedSkipLabel();
    modelDropdown?.classList.add("hidden");
    return;
  }

  btnModel.classList.remove("clarify-skip-mode");
  modelLabelEl.textContent = modelLabelFor(selectedModel);
}

function isInternetAllowedForCurrentSelection() {
  return planRank(user?.plan) >= 1;
}

function getInternetLockMessage() {
  if (planRank(user?.plan) < 1) return tr("chat.internetPlanLocked");
  return "";
}

function enforceInternetConstraint(persist = false) {
  if (!internetAccess || isInternetAllowedForCurrentSelection()) {
    updateInternetToggleUI();
    return;
  }

  internetAccess = false;
  updateInternetToggleUI();

  if (persist) {
    void chromeSet({ [EXT_WEB_ACCESS_KEY]: false });
  }
}

function updateInternetToggleUI() {
  if (btnToggleInternet) {
    const internetAllowed = isInternetAllowedForCurrentSelection();
    const internetEnabled = internetAllowed && internetAccess;
    const lockMessage = getInternetLockMessage();
    btnToggleInternet.classList.toggle("active-toggle", internetEnabled);
    btnToggleInternet.classList.toggle("locked", !internetAllowed);
    btnToggleInternet.setAttribute(
      "title",
      !internetAllowed
        ? lockMessage || tr("chat.internetModelLocked")
        : internetEnabled
          ? tr("chat.internetOn")
          : tr("chat.internetOff"),
    );
    btnToggleInternet.setAttribute(
      "aria-disabled",
      internetAllowed ? "false" : "true",
    );
  }
}

function clearClarifyTypewriterTimer() {
  if (!clarifyTypewriterTimer) return;
  clearInterval(clarifyTypewriterTimer);
  clarifyTypewriterTimer = null;
}

function setClarifyTypewriterTarget(payload = null) {
  const question = String(payload?.question || "");
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const prev = clarifyTypewriterState;

  const nextOptionLengths = options.map((option, index) =>
    Math.min(
      Number(prev.optionLengths[index] || 0),
      String(option?.label || "").length,
    ),
  );
  const shownFromLengths = nextOptionLengths.filter((len) => len > 0).length;

  clarifyTypewriterState = {
    questionLength: Math.min(prev.questionLength, question.length),
    shownOptions: Math.max(
      Math.min(prev.shownOptions, options.length),
      shownFromLengths,
    ),
    optionLengths: nextOptionLengths,
  };
}

function isClarifyTypewriterComplete() {
  const question = String(activeClarifyPopup?.question || "");
  const options = Array.isArray(activeClarifyPopup?.options)
    ? activeClarifyPopup.options
    : [];

  if (clarifyTypewriterState.questionLength < question.length) return false;
  if (clarifyTypewriterState.shownOptions < options.length) return false;

  for (let i = 0; i < options.length; i++) {
    const targetLen = String(options[i]?.label || "").length;
    const currentLen = Number(clarifyTypewriterState.optionLengths[i] || 0);
    if (currentLen < targetLen) return false;
  }

  return true;
}

function stepClarifyTypewriter() {
  const question = String(activeClarifyPopup?.question || "");
  const options = Array.isArray(activeClarifyPopup?.options)
    ? activeClarifyPopup.options
    : [];

  let questionLength = clarifyTypewriterState.questionLength;
  let shownOptions = clarifyTypewriterState.shownOptions;
  const optionLengths = [...clarifyTypewriterState.optionLengths];
  let changed = false;

  if (questionLength < question.length) {
    questionLength = Math.min(
      question.length,
      questionLength + CLARIFY_QUESTION_CHARS_PER_TICK,
    );
    changed = true;
  } else if (options.length > 0) {
    if (shownOptions === 0) {
      shownOptions = 1;
      if (!Number.isFinite(optionLengths[0])) optionLengths[0] = 0;
      changed = true;
    } else {
      let activeOptionIndex = -1;
      for (let i = 0; i < shownOptions; i++) {
        const targetLen = String(options[i]?.label || "").length;
        const currentLen = Number(optionLengths[i] || 0);
        if (currentLen < targetLen) {
          activeOptionIndex = i;
          break;
        }
      }

      if (activeOptionIndex >= 0) {
        const targetLen = String(
          options[activeOptionIndex]?.label || "",
        ).length;
        optionLengths[activeOptionIndex] = Math.min(
          targetLen,
          Number(optionLengths[activeOptionIndex] || 0) +
            CLARIFY_OPTION_CHARS_PER_TICK,
        );
        changed = true;
      } else if (shownOptions < options.length) {
        shownOptions += 1;
        if (!Number.isFinite(optionLengths[shownOptions - 1])) {
          optionLengths[shownOptions - 1] = 0;
        }
        changed = true;
      }
    }
  }

  if (!changed) return false;

  clarifyTypewriterState = {
    questionLength,
    shownOptions,
    optionLengths,
  };

  return true;
}

function upsertClarifyPopupLoading(show = false) {
  if (!clarifyPopupOptions) return;

  const existing = clarifyPopupOptions.querySelector(".clarify-popup-loading");
  if (!show) {
    if (existing) existing.remove();
    return;
  }

  if (existing) {
    existing.textContent = "Typing...";
    return;
  }

  const loading = document.createElement("div");
  loading.className = "clarify-popup-loading";
  loading.textContent = "Typing...";
  clarifyPopupOptions.appendChild(loading);
}

function getOrCreateClarifyOptionButton(index) {
  if (!clarifyPopupOptions) return null;

  let button = clarifyPopupOptions.querySelector(
    `.clarify-popup-option[data-option-index="${index}"]`,
  );
  if (button) return button;

  button = document.createElement("button");
  button.type = "button";
  button.className = "clarify-popup-option";
  button.dataset.optionIndex = String(index);

  const badge = document.createElement("span");
  badge.className = "clarify-popup-option-badge";

  const label = document.createElement("span");
  label.className = "clarify-popup-option-label";

  button.appendChild(badge);
  button.appendChild(label);
  button.addEventListener("click", () => {
    const optionIndex = Number(button.dataset.optionIndex || "-1");
    const option = activeClarifyPopup?.options?.[optionIndex];
    if (!option) return;

    const optionReply = /^[A-E]$/.test(option.id)
      ? `${option.id}) ${option.label}`
      : option.label;
    const quickReply = formatClarifyReply(
      String(activeClarifyPopup?.question || ""),
      optionReply,
    );
    sendClarifyReply(quickReply);
  });

  clarifyPopupOptions.appendChild(button);
  return button;
}

function renderClarifyPopupTypingFrame() {
  if (!clarifyPopup || !clarifyPopupQuestion || !clarifyPopupOptions) return;
  if (!activeClarifyPopup) return;

  const question = String(activeClarifyPopup.question || "");
  const options = Array.isArray(activeClarifyPopup.options)
    ? activeClarifyPopup.options
    : [];

  const typedQuestion = question.slice(
    0,
    clarifyTypewriterState.questionLength,
  );
  clarifyPopupQuestion.textContent = typedQuestion || " ";
  clarifyPopupQuestion.classList.toggle(
    "clarify-popup-question-typing",
    !isClarifyTypewriterComplete(),
  );

  const visibleCount = Math.min(
    Math.max(0, clarifyTypewriterState.shownOptions),
    options.length,
  );

  clarifyPopupOptions
    .querySelectorAll(".clarify-popup-option")
    .forEach((btn) => {
      const index = Number(btn.dataset.optionIndex || "-1");
      if (index >= visibleCount) btn.remove();
    });

  let optionsStillTyping = false;
  for (let i = 0; i < visibleCount; i++) {
    const option = options[i] || {};
    const fullLabel = String(option.label || "");
    const typedLen = Math.min(
      Number(clarifyTypewriterState.optionLengths[i] || 0),
      fullLabel.length,
    );
    if (typedLen < fullLabel.length) optionsStillTyping = true;

    const button = getOrCreateClarifyOptionButton(i);
    if (!button) continue;

    button.dataset.optionIndex = String(i);

    const badge = button.querySelector(".clarify-popup-option-badge");
    const label = button.querySelector(".clarify-popup-option-label");
    if (!badge || !label) continue;

    badge.textContent = String(i + 1);
    label.textContent = fullLabel.slice(0, typedLen) || " ";
    label.classList.toggle("typing", typedLen < fullLabel.length);
    button.disabled = typedLen === 0;
  }

  const hasPendingOptions = visibleCount < options.length;
  const showLoading =
    options.length === 0 || optionsStillTyping || hasPendingOptions;
  upsertClarifyPopupLoading(showLoading);
}

function startClarifyTypewriter() {
  renderClarifyPopupTypingFrame();

  if (isClarifyTypewriterComplete()) {
    clearClarifyTypewriterTimer();
    return;
  }

  if (clarifyTypewriterTimer) return;

  clarifyTypewriterTimer = setInterval(() => {
    const changed = stepClarifyTypewriter();
    if (changed) {
      renderClarifyPopupTypingFrame();
    }

    if (isClarifyTypewriterComplete()) {
      clearClarifyTypewriterTimer();
    }
  }, CLARIFY_TYPE_INTERVAL_MS);
}

function clearQueuedClarifyPopup() {
  if (!clarifyPopupTimer) return;
  clearTimeout(clarifyPopupTimer);
  clarifyPopupTimer = null;
}

function queueClarifyPopup(payload, options = {}) {
  if (!payload) return;
  const immediate =
    options?.immediate === true ||
    options?.liveUpdate === true ||
    CLARIFY_POPUP_DELAY_MS <= 0;
  clearQueuedClarifyPopup();

  if (immediate) {
    openClarifyPopup(payload);
    return;
  }

  clarifyPopupTimer = setTimeout(
    () => {
      clarifyPopupTimer = null;
      openClarifyPopup(payload);
    },
    immediate ? 0 : CLARIFY_POPUP_DELAY_MS,
  );
}

// close clarify popup: clear state + reset DOM + update UI input area
function hideClarifyPopup() {
  clearQueuedClarifyPopup();
  clearClarifyTypewriterTimer();
  // reset typewriter animation state
  clarifyTypewriterState = {
    questionLength: 0,
    shownOptions: 0,
    optionLengths: [],
  };
  if (!clarifyPopup) return;
  activeClarifyPopup = null;
  activeClarifyPopupSignature = "";
  clarifyPopup.classList.add("hidden");
  clarifyPopup.setAttribute("aria-hidden", "true");
  // clear popup DOM content
  if (clarifyPopupOptions) clarifyPopupOptions.innerHTML = "";
  if (clarifyPopupQuestion) {
    clarifyPopupQuestion.textContent = "";
    clarifyPopupQuestion.classList.remove("clarify-popup-question-typing");
  }
  if (clarifyPopupStep) {
    clarifyPopupStep.textContent = "";
    clarifyPopupStep.classList.add("hidden");
  }
  // update main input placeholder + button states
  updateMainInputPlaceholder();
  updateInputIconState();
  updateModelButtonState();
}

// handle clarification popup option selection: set als chat reply + submit
function sendClarifyReply(rawValue = "") {
  const value = String(rawValue || "").trim();
  if (!value) return;

  hideClarifyPopup();
  // mark request als clarify reply für backend
  pendingClarifyReply = true;
  chatInput.value = value;
  chatInput.dispatchEvent(new Event("input", { bubbles: true }));

  if (isSending) {
    abortController?.abort();

    // wait until current stream fully settles, then send clarify reply
    let retriesLeft = 25;
    const retrySend = () => {
      if (!isSending) {
        void sendMessage();
        return;
      }
      if (retriesLeft <= 0) return;
      retriesLeft -= 1;
      setTimeout(retrySend, 60);
    };
    setTimeout(retrySend, 0);
    return;
  }

  void sendMessage();
}

// open clarify popup: render question + options mit typewriter animation
function openClarifyPopup(payload) {
  if (!clarifyPopup || !payload?.question || !Array.isArray(payload?.options))
    return;

  // skip duplicate popups (same question/options)
  const nextSignature = getClarifyPayloadSignature(payload);
  if (nextSignature && nextSignature === activeClarifyPopupSignature) {
    return;
  }

  clearQueuedClarifyPopup();

  // set active popup state + prepare typewriter animation
  activeClarifyPopup = payload;
  activeClarifyPopupSignature = nextSignature;
  setClarifyTypewriterTarget(payload);
  clarifyPopup.setAttribute("aria-label", payload.question);

  // show step counter wenn multi-step clarification (e.g., "1 von 3")
  if (
    payload.step &&
    payload.totalSteps &&
    payload.totalSteps > 1 &&
    Number.isFinite(payload.step) &&
    Number.isFinite(payload.totalSteps)
  ) {
    clarifyPopupStep.textContent = `${payload.step} von ${payload.totalSteps}`;
    clarifyPopupStep.classList.remove("hidden");
  } else {
    clarifyPopupStep.textContent = "";
    clarifyPopupStep.classList.add("hidden");
  }

  // display popup + start typewriter
  clarifyPopup.classList.remove("hidden");
  clarifyPopup.setAttribute("aria-hidden", "false");
  startClarifyTypewriter();
  // update input area styles
  updateMainInputPlaceholder();
  updateInputIconState();
  updateModelButtonState();
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
  updateLegalLabels();
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
    updateLegalLabels();
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
  applyAiStyleSelection(aiStyle);

  const stored = await chromeGet([TOKEN_KEY, USER_KEY, EXT_WEB_ACCESS_KEY]);
  token = stored[TOKEN_KEY] || getAuthCookie();
  user = stored[USER_KEY] || null;
  const hasStoredInternetPreference = Object.prototype.hasOwnProperty.call(
    stored,
    EXT_WEB_ACCESS_KEY,
  );
  internetAccess = hasStoredInternetPreference
    ? parseBoolean(stored[EXT_WEB_ACCESS_KEY])
    : true;
  if (!hasStoredInternetPreference) {
    await chromeSet({ [EXT_WEB_ACCESS_KEY]: true });
  }
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
    } catch {}
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
  modelWarmUntil.clear();
}

function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { ...opts, headers });
}

async function preloadModel(modelId) {
  if (!token || !modelId) return;

  const now = Date.now();
  const warmUntil = modelWarmUntil.get(modelId) || 0;
  if (warmUntil > now) return;

  try {
    const res = await apiFetch("/api/chat/preload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId }),
    });

    if (res.ok) {
      modelWarmUntil.set(modelId, now + MODEL_PRELOAD_REFRESH_MS);
    }
  } catch {}
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

// Legal Modal Handler
function openLegalModal() {
  legalModal.classList.remove("hidden");
}

function closeLegalModal() {
  legalModal.classList.add("hidden");
}

function updateLegalLabels() {
  legalLabel.textContent = tr("auth.legal");
  legalModalTitle.textContent = tr("auth.legal");
  legalOptionNotice.textContent = tr("auth.legalNotice");
  legalOptionPrivacy.textContent = tr("auth.privacyPolicy");
  legalOptionTerms.textContent = tr("auth.termsOfService");
}

function handleLegalNavigation(page) {
  const langCode = currentLang || "de";
  const pageMap = {
    "legal-notice": `/legal-notice`,
    "privacy-policy": `/privacy-policy`,
    "terms-of-service": `/terms-of-service`,
  };
  const pagePath = pageMap[page] || `/legal-notice`;
  const url = `http://localhost:5173${pagePath}?lang=${langCode}`;
  
  chrome.tabs.create({ url });
  closeLegalModal();
}

btnLegal?.addEventListener("click", openLegalModal);
legalModalOverlay?.addEventListener("click", closeLegalModal);
legalModalClose?.addEventListener("click", closeLegalModal);

legalOptions?.forEach((opt) => {
  opt.addEventListener("click", (e) => {
    e.preventDefault();
    const page = opt.dataset.page;
    if (page) handleLegalNavigation(page);
  });
});

// handle auth: login/register flow mit validation, error handling, token persistence
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

// show auth error: display error message in UI
function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove("hidden");
}

// show chat UI: init sidebar from user data, load chat list, preload model for subscription
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
  enforceInternetConstraint(true);
  updateModelDropdown();
  void preloadModel(selectedModel);

  loadChatList();

  handleNewChat();
}

// plan rank: normalize user plan to numeric tier (free=0, pro=1, max/admin=2)
function planRank(plan) {
  const p = (plan || "Free").toLowerCase();
  if (p === "admin" || p === "max") return 2;
  if (p === "pro") return 1;
  return 0;
}

// update model for plan: assign model tier based on user subscription (2b free, 4b pro, 8b max)
function updateModelForPlan() {
  const rank = planRank(user?.plan);
  if (rank >= 2) selectedModel = "qwen3-vl:8b-instruct-max";
  else if (rank >= 1) selectedModel = "qwen3-vl:8b-instruct";
  else selectedModel = "qwen3-vl:4b-instruct";
  updateModelButtonState();
}

// model label: get translated label for model ID
function modelLabelFor(modelId) {
  return getModelLabel(modelId);
}

// update model dropdown: toggle locked state based on plan rank, highlight active model
function updateModelDropdown() {
  const rank = planRank(user?.plan);
  modelOptions.forEach((opt) => {
    const model = MODELS.find((m) => m.id === opt.dataset.model);
    opt.classList.toggle("active", opt.dataset.model === selectedModel);
    opt.classList.toggle("locked", model && model.rank > rank);
  });
  updateModelButtonState();
}

btnModel.addEventListener("click", () => {
  if (isClarifyPopupOpen()) {
    hideClarifyPopup();
    return;
  }
  modelDropdown.classList.toggle("hidden");
});
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
    void preloadModel(selectedModel);
  });
});

btnToggleSB.addEventListener("click", () => toggleSidebar(!sidebarOpen));
btnCloseSB?.addEventListener("click", () => toggleSidebar(false));
sidebarOverlay.addEventListener("click", () => toggleSidebar(false));

// toggle sidebar: show/hide chat history sidebar and overlay
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

const sidebarProfile = $("#sidebar-profile");
sidebarProfile?.addEventListener("click", (e) => {
  // Prevent redirect if logout button is clicked
  if (e.target.closest(".sidebar-logout")) return;
  const url = "http://localhost:5173/profile";
  chrome.tabs.create({ url });
});

// load chat list: fetch all user chats from backend API + render in sidebar
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

// render chat list: build DOM list with chat items, add click + delete handlers
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

// load chat: fetch specific chat messages from backend + display in UI
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

// delete chat: remove chat file from backend, reset UI if currently viewing it
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

// handle new chat: clear message history, abort streaming, reset UI state
function handleNewChat() {
  if (abortController) abortController.abort();
  hideClarifyPopup();
  messages = [];
  currentChatId = null;
  isSending = false;
  chatInput.value = "";
  clearImage();
  renderMessages();
  chatInput.focus();
}

btnPlus.addEventListener("click", (e) => {
  if (btnPlus.disabled) return;
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
  if (!isInternetAllowedForCurrentSelection()) {
    internetAccess = false;
    updateInternetToggleUI();
    await chromeSet({ [EXT_WEB_ACCESS_KEY]: false });
    toast(getInternetLockMessage() || tr("chat.internetModelLocked"), "error");
    return;
  }

  internetAccess = !internetAccess;
  updateInternetToggleUI();
  await chromeSet({ [EXT_WEB_ACCESS_KEY]: internetAccess });
});

$$(".plus-menu-item[data-style]").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyAiStyleSelection(btn.dataset.style);
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

// clear image preview + reset file input state
btnRemoveImg.addEventListener("click", clearImage);

// clear image preview + reset file input state
// clear image preview + reset file input state
function clearImage() {
  imageFile = null;
  imagePreview = null;
  imgPreviewBar.classList.add("hidden");
  imgPreviewImg.src = "";
  fileInput.value = "";
}

// normalize for context match: lowercase + normalize diacritics + tokenize for keyword matching
function normalizeForContextMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// extract context match tokens: split normalized text, filter short words + stopwords
function extractContextMatchTokens(value = "") {
  const normalized = normalizeForContextMatch(value);
  if (!normalized) return [];

  const words = normalized.split(" ").filter(Boolean);
  const out = [];
  const seen = new Set();

  for (const word of words) {
    if (word.length < 4) continue;
    if (CONTEXT_MATCH_STOPWORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }

  return out;
}

// has meaningful title overlap: check if prompt + chat title share keywords for context matching
function hasMeaningfulTitleOverlap(prompt = "", title = "") {
  const promptTokens = extractContextMatchTokens(prompt);
  const titleTokens = extractContextMatchTokens(title);
  if (!promptTokens.length || !titleTokens.length) return false;

  const titleTokenSet = new Set(titleTokens);
  let overlapCount = 0;
  for (const token of promptTokens) {
    if (!titleTokenSet.has(token)) continue;
    overlapCount++;
    if (overlapCount >= 2) return true;
  }

  return overlapCount >= 1 && FACT_QUESTION_PROMPT_RE.test(prompt);
}

function shouldAttachWebsiteContext(text = "", page = null) {
  if (!text) return false;
  if (WEBSITE_SUMMARY_PROMPT_RE.test(text)) return true;
  if (PAGE_REFERENCE_PROMPT_RE.test(text)) return true;

  const title = String(page?.title || "").trim();
  if (!title) return false;

  return hasMeaningfulTitleOverlap(text, title);
}

async function getActivePageContext() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url) return null;
    if (/^(chrome|chrome-extension|edge|about|view-source):/i.test(tab.url))
      return null;

    const frameResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const title = document.title || "";
        const url = location.href || "";
        const root =
          document.querySelector('main, article, [role="main"]') ||
          document.body ||
          document.documentElement;

        const normalizeLine = (value = "") =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();

        const appendFromNodeList = (
          chunks,
          nodes,
          minLength = 1,
          maxChunks = 320,
        ) => {
          for (const node of nodes || []) {
            const line = normalizeLine(node?.textContent || "");
            if (!line || line.length < minLength) continue;
            chunks.push(line);
            if (chunks.length >= maxChunks) break;
          }
        };

        const appendFromTextBlocks = (
          chunks,
          text,
          minLength = 25,
          maxChunks = 320,
        ) => {
          const blocks = String(text || "")
            .split(/\n+/)
            .map((line) => normalizeLine(line))
            .filter((line) => line.length >= minLength);

          for (const block of blocks) {
            chunks.push(block);
            if (chunks.length >= maxChunks) break;
          }
        };

        const chunks = [];

        appendFromNodeList(
          chunks,
          root?.querySelectorAll?.("h1, h2, h3"),
          2,
          80,
        );
        appendFromNodeList(chunks, root?.querySelectorAll?.("p, li"), 25, 280);

        // Fallback for static/offline pages: use visible text if semantic tags are sparse.
        if (chunks.join("\n").length < 600) {
          appendFromTextBlocks(
            chunks,
            root?.innerText || document.body?.innerText || "",
            20,
            320,
          );
        }

        // Last fallback: derive readable text from raw HTML.
        if (chunks.join("\n").length < 320) {
          const html = String(document.documentElement?.outerHTML || "");
          const htmlText = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/\s+/g, " ")
            .trim();

          const sentences = (htmlText.match(/[^.!?]{25,}[.!?]?/g) || []).slice(
            0,
            260,
          );
          appendFromTextBlocks(chunks, sentences.join("\n"), 20, 320);
        }

        const metaDescription = normalizeLine(
          document
            .querySelector(
              'meta[name="description"], meta[property="og:description"]',
            )
            ?.getAttribute("content") || "",
        );
        if (metaDescription) chunks.unshift(metaDescription);

        const unique = [];
        const seen = new Set();
        for (const chunk of chunks) {
          const key = chunk.toLowerCase();
          if (!chunk || seen.has(key)) continue;
          seen.add(key);
          unique.push(chunk);
          if (unique.length >= 320) break;
        }

        let content = unique.join("\n");
        content = content
          .replace(/\s+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        if (!content) {
          content = normalizeLine(title || url);
        }
        if (content.length > 4500) content = content.slice(0, 4500);

        return { title, url, content };
      },
    });

    const candidates = (frameResults || [])
      .map((entry) => entry?.result)
      .filter((entry) => entry && typeof entry === "object");
    if (!candidates.length) return null;

    const scoreCandidate = (candidate) => {
      const contentLen = String(candidate?.content || "").length;
      const titleLen = String(candidate?.title || "").length;
      return contentLen * 5 + titleLen;
    };

    return (
      [...candidates].sort(
        (a, b) => scoreCandidate(b) - scoreCandidate(a),
      )[0] || null
    );
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

// send message to Wieland API: image upload + page context retrieval + stream response
async function sendMessage() {
  const text =
    chatInput.value.trim() || (imageFile ? tr("chat.describeImage") : "");
  if (!text || isSending) return;

  const popupWasOpen = isClarifyPopupOpen();
  // consume clarify-reply intent atomar at send start to avoid timing races
  const clarifyReplyFromPopup = pendingClarifyReply || popupWasOpen;
  pendingClarifyReply = false;

  const requestText =
    clarifyReplyFromPopup && popupWasOpen
      ? formatClarifyReply(activeClarifyPopup?.question, text)
      : text;

  hideClarifyPopup();

  // UI state: disable input, show stop button
  isSending = true;
  chatInput.value = "";
  chatInput.style.height = "auto";
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");
  btnSend.disabled = true;

  let imageUrl = null;
  const fileCopy = imageFile;
  let pageContext = null;
  let page = null;
  let shouldUsePageContext = false;
  const explicitlyAskedForPage =
    WEBSITE_SUMMARY_PROMPT_RE.test(requestText) ||
    PAGE_REFERENCE_PROMPT_RE.test(requestText);

  // retrieve active page context (title + URL + content)
  try {
    page = await getActivePageContext();
    shouldUsePageContext = shouldAttachWebsiteContext(requestText, page);
  } catch (err) {
    console.warn("getActivePageContext failed:", err);
  }

  // attach page context wenn relevant for query
  if (shouldUsePageContext && page?.content) {
    pageContext = {
      title: String(page.title || "").trim(),
      url: String(page.url || "").trim(),
      content: String(page.content || "").trim(),
    };
  } else if (explicitlyAskedForPage) {
    toast(tr("chat.readPageFailed"), "error");
  }

  // image upload: multipart zum API endpoint
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

      // reset UI on upload failure
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

  // format user message: image markdown + text
  const userContent = imageUrl
    ? `![${tr("chat.image")}](${imageUrl})\n\n${requestText}`
    : requestText;
  const userMsg = { content: userContent, isUser: true, id: uid() };
  messages.push(userMsg);
  renderMessages();
  scrollToBottom();

  // build context: all previous messages für conversation history
  const context = messages.slice(0, -1).map((m) => ({
    role: m.isUser ? "user" : "assistant",
    content: toContextContent(m.content),
  }));

  // add empty AI message placeholder (wird gefüllt mit streaming)
  const aiId = uid();
  messages.push({ content: "", isUser: false, id: aiId, statusEvents: [] });
  renderMessages();
  scrollToBottom();

  abortController = new AbortController();
  let fullText = "";
  let statusEventCarry = "";

  try {
    // build FormData für multipart request (message + context + model settings)
    const fd = new FormData();
    fd.append("message", requestText);
    fd.append("context", JSON.stringify(context));
    fd.append("model", selectedModel);
    fd.append("aiStyle", aiStyle);
    fd.append(
      "internetAccess",
      isInternetAllowedForCurrentSelection() && internetAccess
        ? "true"
        : "false",
    );
    fd.append("clientSource", "extension");

    // optional: mark wenn user antwortet auf clarify popup
    if (clarifyReplyFromPopup) {
      fd.append("clarifyReply", "true");
    }

    // optional: attach page context (wenn available + relevant)
    if (pageContext) {
      fd.append("pageContext", JSON.stringify(pageContext));
      fd.append("preferPageContext", "true");
    }
    // optional: image file (wenn user uploaded)
    if (fileCopy) fd.append("image", fileCopy);

    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
      signal: abortController.signal,
    });

    if (!res.ok) throw new Error(`API ${res.status}`);

    const memorySaved = res.headers.get("X-Wieland-Memory-Saved") === "1";
    const memoryCount = Number(
      res.headers.get("X-Wieland-Memory-Count") || "0",
    );

    if (memorySaved && memoryCount > 0) {
      toast(tr("chat.memorySaved", { count: memoryCount }), "success");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const rawChunk = decoder.decode(value, { stream: true });
      const parsedChunk = extractStatusEventsFromChunk(
        rawChunk,
        statusEventCarry,
      );
      statusEventCarry = parsedChunk.carry;

      if (parsedChunk.events.length) {
        appendMessageStatusEvents(aiId, parsedChunk.events);
      }

      if (!parsedChunk.cleanText) {
        continue;
      }

      fullText += parsedChunk.cleanText;

      const preview = getClarificationStreamPreview(fullText);
      const previewText = preview.text;

      updateMessage(aiId, previewText);
      scrollToBottom();
    }

    if (statusEventCarry) {
      fullText += statusEventCarry;
      statusEventCarry = "";
    }

    const clarification = extractClarificationPayload(fullText);
    const clarificationPayload = clarification.payload;
    const streamPayloadSeen = Boolean(clarificationPayload);
    const finalAssistantText =
      clarification.cleanedText || fullText || tr("chat.shortError");

    if (finalAssistantText !== fullText) {
      fullText = finalAssistantText;
      updateMessage(aiId, finalAssistantText);
      scrollToBottom();
    }

    if (clarificationPayload && streamPayloadSeen) {
      queueClarifyPopup(clarificationPayload, {
        immediate: true,
        liveUpdate: true,
      });
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

// update message content in state + re-render DOM (for streaming updates)
function appendMessageStatusEvents(id, incomingEvents = []) {
  const nextEvents = Array.isArray(incomingEvents)
    ? incomingEvents.filter((event) => event && typeof event === "object")
    : [];
  if (!nextEvents.length) return;

  const msg = messages.find((m) => m.id === id);
  if (!msg) return;

  const previousEvents = Array.isArray(msg.statusEvents)
    ? msg.statusEvents
    : [];
  const mergedEvents = [...previousEvents, ...nextEvents].slice(-10);
  updateMessage(id, msg.content || "", { statusEvents: mergedEvents });
}

function updateMessage(id, content, options = {}) {
  // find message in state + update content
  const msg = messages.find((m) => m.id === id);
  if (!msg) return;

  msg.content = String(content || "");
  if (Array.isArray(options?.statusEvents)) {
    msg.statusEvents = options.statusEvents;
  }

  // re-render message DOM: markdown parse + code block copy buttons
  const el = document.querySelector(`[data-msg-id="${id}"] .message-bubble`);
  if (el) {
    el.innerHTML = msg.content
      ? renderMarkdown(msg.content)
      : renderTypingStateHTML(msg.statusEvents || []);
    bindCodeCopyButtons(el);
  }
}

async function saveChat(generateTitle = false) {
  // persist conversation zu backend: messages array → /api/history/save
  // wenn new chat: generiere title asynchron, sonst: update existing
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

// render chat messages: empty state + list all messages mit user/AI styling
function renderMessages() {
  messagesArea.innerHTML = "";

  // empty state: show welcome message wenn keine messages
  if (messages.length === 0) {
    const welcomeMessages = trArray("welcomeMessages");
    messagesArea.innerHTML = `
      <div class="welcome-container">
        <span class="welcome-text">${welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]}</span>
      </div>`;
    return;
  }

  // build DOM für jeden message (user + AI)
  messages.forEach((msg, idx) => {
    messagesArea.appendChild(createMessageEl(msg, idx));
  });
  scrollToBottom();
}

// create message DOM element: styled bubble + action buttons (copy/regenerate)
function createMessageEl(msg, idx) {
  const div = document.createElement("div");
  div.className = `message ${msg.isUser ? "user-message" : "ai-message"}`;
  div.dataset.msgId = msg.id;

  // extract image markup von message content
  const imageUrl = extractImageUrl(msg.content);
  const textOnly = stripImg(msg.content);

  let bubbleHTML = "";
  if (msg.isUser) {
    // user message: image + text
    if (imageUrl) {
      const imageSrc = resolveImageSrc(imageUrl);
      if (imageSrc) {
        bubbleHTML += `<img class="message-image" src="${imageSrc}" alt="${tr("chat.imageAlt")}"/>`;
      }
    }
    bubbleHTML += escapeHtml(textOnly);
  } else {
    // AI message: markdown render oder loading animation
    bubbleHTML = msg.content
      ? renderMarkdown(msg.content)
      : renderTypingStateHTML(msg.statusEvents || []);
  }

  // assemble message bubble + action buttons
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

  // attach click handlers für copy/regenerate buttons
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

  // bind code block copy buttons
  const bubbleEl = div.querySelector(".message-bubble");
  if (bubbleEl) bindCodeCopyButtons(bubbleEl);

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
  hideClarifyPopup();
  renderMessages();

  isSending = true;
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");
  abortController = new AbortController();

  const aiId = uid();
  messages.push({ content: "", isUser: false, id: aiId, statusEvents: [] });
  renderMessages();

  const context = messages.slice(0, -1).map((m) => ({
    role: m.isUser ? "user" : "assistant",
    content: toContextContent(m.content),
  }));

  let fullText = "";
  let statusEventCarry = "";

  try {
    const fd = new FormData();
    let requestText = toContextContent(userMsg.content);
    let pageContext = null;
    const page = await getActivePageContext();
    if (shouldAttachWebsiteContext(requestText, page) && page?.content) {
      pageContext = {
        title: String(page.title || "").trim(),
        url: String(page.url || "").trim(),
        content: String(page.content || "").trim(),
      };
    }

    fd.append("message", requestText);
    fd.append("context", JSON.stringify(context.slice(0, -1)));
    fd.append("model", selectedModel);
    fd.append("aiStyle", aiStyle);
    fd.append(
      "internetAccess",
      isInternetAllowedForCurrentSelection() && internetAccess
        ? "true"
        : "false",
    );
    fd.append("clientSource", "extension");
    if (pageContext) {
      fd.append("pageContext", JSON.stringify(pageContext));
      fd.append("preferPageContext", "true");
    }

    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);

    const memorySaved = res.headers.get("X-Wieland-Memory-Saved") === "1";
    const memoryCount = Number(
      res.headers.get("X-Wieland-Memory-Count") || "0",
    );

    if (memorySaved && memoryCount > 0) {
      toast(tr("chat.memorySaved", { count: memoryCount }), "success");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const rawChunk = decoder.decode(value, { stream: true });
      const parsedChunk = extractStatusEventsFromChunk(
        rawChunk,
        statusEventCarry,
      );
      statusEventCarry = parsedChunk.carry;

      if (parsedChunk.events.length) {
        appendMessageStatusEvents(aiId, parsedChunk.events);
      }

      if (!parsedChunk.cleanText) {
        continue;
      }

      fullText += parsedChunk.cleanText;

      const preview = getClarificationStreamPreview(fullText);
      const previewText = preview.text;

      updateMessage(aiId, previewText);
      scrollToBottom();
    }

    if (statusEventCarry) {
      fullText += statusEventCarry;
      statusEventCarry = "";
    }

    const clarification = extractClarificationPayload(fullText);
    const clarificationPayload = clarification.payload;
    const streamPayloadSeen = Boolean(clarificationPayload);
    const finalAssistantText =
      clarification.cleanedText || fullText || tr("chat.shortError");

    if (finalAssistantText !== fullText) {
      fullText = finalAssistantText;
      updateMessage(aiId, finalAssistantText);
      scrollToBottom();
    }

    if (clarificationPayload && streamPayloadSeen) {
      queueClarifyPopup(clarificationPayload, {
        immediate: true,
        liveUpdate: true,
      });
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
  const { cleanedText } = extractClarificationPayload(raw);
  const source = normalizeMarkdownCodeFences(String(cleanedText || raw || ""));

  const codeBlocks = [];
  const withCodePlaceholders = source.replace(
    /```([a-zA-Z0-9_+.-]*)\n([\s\S]*?)```/g,
    (_full, rawLang, rawCode) => {
      const index =
        codeBlocks.push({
          lang: String(rawLang || "").trim(),
          code: String(rawCode || "").replace(/\n+$/, ""),
        }) - 1;
      return `@@CODEBLOCK_${index}@@`;
    },
  );

  let html = escapeHtmlText(withCodePlaceholders)
    .replace(/@@CODEBLOCK_(\d+)@@/g, (_full, indexRaw) => {
      const index = Number(indexRaw);
      const block = codeBlocks[index];
      if (!block) return "";
      return renderCodeBlockHtml(block.code, block.lang);
    })
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.*?)\*\*/gs, "<strong>$1</strong>")
    .replace(/__(.*?)__/gs, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gs, "<em>$1</em>")
    .replace(/_(.*?)_/gs, "<em>$1</em>")
    .replace(
      /\[(.*?)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    )
    .replace(/^\s*[-*•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br/>");

  html = html.replace(/((?:<li>.*?<\/li>(?:<br\/>)?)+)/g, "<ul>$1</ul>");
  html = html.replace(
    /<ul>(.*?)<\/ul>/gs,
    (_, inner) => "<ul>" + inner.replace(/<br\/>/g, "") + "</ul>",
  );

  return html;
}

const CODE_FENCE_LINE_RE = /^```([a-zA-Z0-9_+.-]*)\s*$/;

function normalizeMarkdownCodeFences(raw = "") {
  const source = String(raw || "").replace(/\r\n/g, "\n");
  if (!source) return "";

  const lines = source.split("\n");
  const out = [];
  let inFence = false;
  let activeLang = "";

  for (const line of lines) {
    const match = line.match(CODE_FENCE_LINE_RE);
    if (!match) {
      out.push(line);
      continue;
    }

    const fenceLang = String(match[1] || "")
      .trim()
      .toLowerCase();

    if (!inFence) {
      inFence = true;
      activeLang = fenceLang;
      out.push(line);
      continue;
    }

    if (!fenceLang) {
      inFence = false;
      activeLang = "";
      out.push("```");
      continue;
    }

    if (activeLang && fenceLang === activeLang) {
      continue;
    }

    out.push(line);
  }

  if (inFence) {
    out.push("```");
  }

  return out.join("\n");
}

function escapeHtmlText(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encodeCodePayload(value = "") {
  try {
    return btoa(unescape(encodeURIComponent(String(value || ""))));
  } catch {
    return "";
  }
}

function decodeCodePayload(value = "") {
  try {
    return decodeURIComponent(escape(atob(String(value || ""))));
  } catch {
    return "";
  }
}

function renderCodeBlockHtml(code = "", rawLang = "") {
  const lang = String(rawLang || "").trim() || "text";
  const payload = encodeCodePayload(code);

  return [
    '<div class="chat-code-block">',
    '<div class="chat-code-head">',
    `<span class="chat-code-lang">${escapeHtmlText(lang)}</span>`,
    `<button type="button" class="code-copy-btn" data-code="${payload}" title="Copy code">Copy</button>`,
    "</div>",
    `<pre><code>${escapeHtmlText(code)}</code></pre>`,
    "</div>",
  ].join("");
}

function bindCodeCopyButtons(rootEl) {
  if (!rootEl) return;

  rootEl.querySelectorAll(".code-copy-btn").forEach((button) => {
    if (button.dataset.boundCopy === "1") return;
    button.dataset.boundCopy = "1";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const encoded = button.getAttribute("data-code") || "";
      const decoded = decodeCodePayload(encoded);
      if (!decoded) return;

      try {
        await navigator.clipboard.writeText(decoded);
        toast(tr("chat.copied"), "success");
      } catch {
        toast(tr("chat.shortError"), "error");
      }
    });
  });
}

function escapeHtmlAttr(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function activityIconSVG(type = "") {
  if (
    type === "search_start" ||
    type === "search_done" ||
    type === "search_error"
  ) {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="16.65" y1="16.65" x2="21" y2="21"></line></svg>';
  }

  if (
    type === "memory_start" ||
    type === "memory_done" ||
    type === "memory_error"
  ) {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M8 2v6"></path><path d="M16 2v6"></path><path d="M8 22v-3"></path><path d="M16 22v-3"></path></svg>';
  }

  if (type === "page_read") {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h7l5 5v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M15 3v6h6"></path></svg>';
  }

  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.2 4.8L19 9l-4.8 2.2L12 16l-2.2-4.8L5 9l4.8-2.2z"></path></svg>';
}

function renderActivityFeedHTML(events = []) {
  const list = Array.isArray(events) ? events.slice(-8) : [];
  if (!list.length) return "";

  const itemsHtml = list
    .map((event) => {
      const type = String(event?.type || "");
      const safeType = type || "thinking";
      let contentHtml = "";

      if (type === "search_start") {
        const query = String(event?.query || "").trim();
        contentHtml = `<span>${escapeHtml(tr("chat.activity.searchStart", { query }))}</span>`;
      } else if (type === "search_done") {
        const sources = Array.isArray(event?.sources) ? event.sources : [];
        const sourceChips = sources
          .map((source, index) => {
            const rawUrl = String(source?.url || "").trim();
            const label =
              getActivitySourceHost(rawUrl) ||
              String(source?.title || "").trim() ||
              tr("chat.activity.sourceFallback", { index: index + 1 });

            let safeUrl = "";
            try {
              const parsed = new URL(rawUrl);
              if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                safeUrl = parsed.toString();
              }
            } catch {}

            if (!safeUrl) {
              return `<span class="activity-source-chip">${escapeHtml(label)}</span>`;
            }

            return `<a class="activity-source-chip" href="${escapeHtmlAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
          })
          .join("");

        contentHtml = `<span>${escapeHtml(tr("chat.activity.searchDone", { count: sources.length }))}</span>${sourceChips ? `<div class="activity-source-list">${sourceChips}</div>` : ""}`;
      } else if (type === "search_error") {
        contentHtml = `<span>${escapeHtml(tr("chat.activity.searchUnavailable"))}</span>`;
      } else if (type === "memory_start") {
        contentHtml = `<span>${escapeHtml(tr("chat.activity.memoryStart"))}</span>`;
      } else if (type === "memory_done") {
        const items = Array.isArray(event?.items) ? event.items : [];
        const memoryChips = items
          .map((item) => {
            const label = String(item?.label || "").trim();
            const value = String(item?.value || "").trim();
            const chipText = value ? `${label}: ${value}` : label;
            if (!chipText) return "";
            return `<span class="activity-memory-chip">${escapeHtml(chipText)}</span>`;
          })
          .filter(Boolean)
          .join("");

        contentHtml = `<span>${escapeHtml(items.length ? tr("chat.activity.memoryDone") : tr("chat.activity.memoryEmpty"))}</span>${memoryChips ? `<div class="activity-memory-list">${memoryChips}</div>` : ""}`;
      } else if (type === "memory_error") {
        contentHtml = `<span>${escapeHtml(tr("chat.activity.memoryUnavailable"))}</span>`;
      } else if (type === "page_read") {
        const title =
          String(event?.title || "").trim() ||
          getActivitySourceHost(event?.url || "") ||
          tr("chat.activity.currentPage");
        contentHtml = `<span>${escapeHtml(tr("chat.activity.pageRead", { title }))}</span>`;
      } else {
        contentHtml = `<span>${escapeHtml(tr("chat.activity.thinking"))}</span>`;
      }

      return `<div class="activity-item activity-${escapeHtmlAttr(safeType)}"><span class="activity-icon-wrap">${activityIconSVG(type)}</span><div class="activity-content">${contentHtml}</div></div>`;
    })
    .join("");

  return `<div class="activity-feed">${itemsHtml}</div>`;
}

function renderTypingStateHTML(statusEvents = []) {
  const list = Array.isArray(statusEvents) ? statusEvents : [];
  const activityHtml = renderActivityFeedHTML(list);

  return `<div class="typing-state-stack">${activityHtml}${typingLoaderHTML()}</div>`;
}

function typingLoaderHTML() {
  return `<div class="loader">
    <div class="circle"><div class="dot"></div><div class="outline"></div></div>
    <div class="circle"><div class="dot"></div><div class="outline"></div></div>
    <div class="circle"><div class="dot"></div><div class="outline"></div></div>
    <div class="circle"><div class="dot"></div><div class="outline"></div></div>
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
  const withoutImage = text.replace(/!\[.*?\]\([^)]+\)\n\n?/g, "").trim();
  return extractClarificationPayload(withoutImage).cleanedText;
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

// auto-scroll zu bottom: chat messages immer sichtbar (mit RAF für smooth animation)
function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  });
}

function rememberPointerPosition(event = null) {
  if (!event) return;

  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    lastPointerPosition = { x: event.clientX, y: event.clientY };
    return;
  }

  const touch = event.touches?.[0] || event.changedTouches?.[0];
  if (
    touch &&
    Number.isFinite(touch.clientX) &&
    Number.isFinite(touch.clientY)
  ) {
    lastPointerPosition = { x: touch.clientX, y: touch.clientY };
  }
}

function getToastFollowPosition(pointer = lastPointerPosition) {
  const margin = TOAST_VIEWPORT_MARGIN;
  const width = Number(window.innerWidth || 0);
  const height = Number(window.innerHeight || 0);
  const maxX = Math.max(margin, width - margin - TOAST_ESTIMATED_WIDTH);
  const maxY = Math.max(margin, height - margin);

  const rawX = Number.isFinite(pointer?.x)
    ? pointer.x + TOAST_POINTER_OFFSET_X
    : maxX;
  const rawY = Number.isFinite(pointer?.y)
    ? pointer.y + TOAST_POINTER_OFFSET_Y
    : maxY;

  return {
    x: Math.max(margin, Math.min(maxX, rawX)),
    y: Math.max(margin, Math.min(maxY, rawY)),
  };
}

function positionToastElement(el) {
  if (!el || !el.isConnected) return;
  const pos = getToastFollowPosition(lastPointerPosition);
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
}

document.addEventListener("pointermove", rememberPointerPosition, {
  passive: true,
});
document.addEventListener("pointerdown", rememberPointerPosition, {
  passive: true,
});
document.addEventListener("touchstart", rememberPointerPosition, {
  passive: true,
});

// show temporary toast notification (auto-dismiss nach 3s)
function toast(msg, type = "error") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  positionToastElement(el);

  const fadeDelay = Math.max(0, TOAST_LIFETIME_MS - TOAST_FADE_DURATION_MS);
  const fadeTimer = setTimeout(() => {
    if (el.isConnected) {
      el.classList.add("leaving");
    }
  }, fadeDelay);

  const removeToast = () => {
    clearTimeout(fadeTimer);
    if (el.isConnected) {
      el.remove();
    }
  };

  setTimeout(removeToast, TOAST_LIFETIME_MS);
}

initStarsBackground();
init();
