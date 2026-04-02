const API_BASE = "http://localhost:3001";

const EXT_LANG_KEY = "wieland_lang";
const TOKEN_KEY = "wieland_token";
const USER_KEY = "wieland_user";
const EXT_WEB_ACCESS_KEY = "wieland_ext_internet_access";
const AUTH_COOKIE_KEY = "wieland_ext_token";
const WEBSITE_LANG_COOKIE_KEY = "wieland_lang";
const MAIN_WEBSITE_HOSTS = ["localhost", "127.0.0.1"];
const LANG_SYNC_INTERVAL_MS = 1500;
const MODEL_PRELOAD_REFRESH_MS = 10 * 60 * 1000;
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
const CLARIFY_JSON_OPEN_RE =
  /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_CLOSE_RE =
  /\[\[\s*\/\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_TOKEN_RE = /WIELAND[\s_-]*CLARIFY[\s_-]*JSON/i;
const CLARIFY_OPTION_LINE_RE = /^\s*([A-E])[)\].:-]\s*(.+)$/i;
const CLARIFY_OPTION_IDS = ["A", "B", "C", "D", "E"];
const CLARIFY_POPUP_DELAY_MS = 240;
const CLARIFY_VAGUE_BUILD_VERB_RE =
  /\b(mach|mache|build|make|create|generate|generat|generier|erstell\w*|baue?\b|program\w*|entwickl\w*|crea|sviluppa|fai)\b/i;
const CLARIFY_VAGUE_BUILD_TARGET_RE =
  /\b(app|website|webseite|landing\s+page|tool|projekt|project|bot|script|programm|program|dashboard|automation|automatisierung|extension)\b/i;
const CLARIFY_VAGUE_BUILD_SCOPE_HINT_RE =
  /\b(react|vue|svelte|html|css|javascript|typescript|node|python|java|single\s+file|mehrere\s+dateien|backend|frontend|api|mobile|ios|android|chrome\s+extension|browser\s+extension|deadline|budget|zielgruppe|target\s+audience)\b/i;
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
    if (!/^[A-E]$/.test(id)) id = CLARIFY_OPTION_IDS[out.length] || "";
    if (!id) continue;

    out.push({ id, label });
  }

  return out;
}

function toSingleSentenceQuestion(value = "", fallback = "") {
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

function isClarifyQaReplyText(value = "") {
  const source = String(value || "").trim();
  if (!source) return false;

  return /^q\s*:/i.test(source) && /(?:^|\n)\s*a\s*:/im.test(source);
}

function formatClarifyReply(question = "", answer = "") {
  const cleanAnswer = String(answer || "").trim();
  if (!cleanAnswer) return "";
  if (isClarifyQaReplyText(cleanAnswer)) return cleanAnswer;

  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) return cleanAnswer;

  return `Q: ${cleanQuestion}\nA: ${cleanAnswer}`;
}

function isLikelyVagueBuildPromptClient(message = "") {
  const source = String(message || "").trim();
  if (!source) return false;

  const compact = source
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = compact.split(" ").filter(Boolean).length;

  if (wordCount > 10) return false;
  if (!CLARIFY_VAGUE_BUILD_VERB_RE.test(compact)) return false;
  if (!CLARIFY_VAGUE_BUILD_TARGET_RE.test(compact)) return false;
  if (CLARIFY_VAGUE_BUILD_SCOPE_HINT_RE.test(compact)) return false;

  return true;
}

function detectClarifyFallbackLanguageFromText(message = "") {
  const source = String(message || "").toLowerCase();
  if (!source) return "en";

  if (
    /[àèéìíîòóù]/i.test(source) ||
    /\b(che|quando|dove|vorrei|fammi|crea|costruisci|sito|estensione|automazione)\b/i.test(
      source,
    )
  ) {
    return "it";
  }

  if (
    /[äöüß]/i.test(source) ||
    /\b(und|oder|ich|bitte|mach|baue|erstell|frage|website|webseite)\b/i.test(
      source,
    )
  ) {
    return "de";
  }

  return "en";
}

function buildClientForcedClarificationFallbackPayload(message = "") {
  const lang = detectClarifyFallbackLanguageFromText(message);

  if (lang === "de") {
    return {
      question: "Worauf soll ich mich zuerst fokussieren?",
      options: [
        { id: "A", label: "Website oder Landingpage" },
        { id: "B", label: "Web-App" },
        { id: "C", label: "Browser-Erweiterung" },
        { id: "D", label: "Automatisierung oder Script" },
        { id: "E", label: "Etwas anderes" },
      ],
      allowFreeform: true,
      freeformPlaceholder: "Kurz beschreiben",
      skipLabel: "Überspringen",
      step: 1,
      totalSteps: 1,
    };
  }

  if (lang === "it") {
    return {
      question: "Su cosa devo concentrarmi per prima cosa?",
      options: [
        { id: "A", label: "Sito web o landing page" },
        { id: "B", label: "Web app" },
        { id: "C", label: "Estensione browser" },
        { id: "D", label: "Automazione o script" },
        { id: "E", label: "Altro" },
      ],
      allowFreeform: true,
      freeformPlaceholder: "Descrivilo in breve",
      skipLabel: "Salta",
      step: 1,
      totalSteps: 1,
    };
  }

  return {
    question: "What should I focus on first?",
    options: [
      { id: "A", label: "Website or landing page" },
      { id: "B", label: "Web app" },
      { id: "C", label: "Browser extension" },
      { id: "D", label: "Automation or script" },
      { id: "E", label: "Something else" },
    ],
    allowFreeform: true,
    freeformPlaceholder: "Describe briefly",
    skipLabel: "Skip",
    step: 1,
    totalSteps: 1,
  };
}

function findClarifyMarkerStart(rawText = "") {
  const source = String(rawText || "");
  if (!source) return -1;

  const openMarkerMatch = source.match(CLARIFY_JSON_OPEN_RE);
  if (
    openMarkerMatch &&
    Number.isInteger(openMarkerMatch.index) &&
    openMarkerMatch.index >= 0
  ) {
    return openMarkerMatch.index;
  }

  const bracketedFragmentIndex = source.toUpperCase().indexOf("[[WIELAND");
  if (bracketedFragmentIndex >= 0) return bracketedFragmentIndex;

  const tokenMatch = source.match(CLARIFY_JSON_TOKEN_RE);
  if (tokenMatch && Number.isInteger(tokenMatch.index) && tokenMatch.index >= 0) {
    return tokenMatch.index;
  }

  return -1;
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
  } catch {
  }

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
    freeformPlaceholder:
      String(
        payload?.freeformPlaceholder ||
          payload?.freeTextPlaceholder ||
          "Etwas anderes",
      ).trim() || "Etwas anderes",
    skipLabel: String(payload?.skipLabel || "Überspringen").trim() ||
      "Überspringen",
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

  const question = lines.slice(0, firstOptionIndex).join(" ").trim() || lines[0];
  const payload = sanitizeClarifyPayload({ question, options }, question);
  if (!payload) return null;

  const keptLines = lines.filter((line) => !CLARIFY_OPTION_LINE_RE.test(line));
  const cleanedText = keptLines.join("\n").trim() || payload.question;
  return { payload, cleanedText };
}

function extractClarificationPayload(rawText = "") {
  const source = String(rawText || "");
  if (!source) return { payload: null, cleanedText: "" };

  const blockMatch = source.match(CLARIFY_JSON_BLOCK_RE);
  if (blockMatch) {
    const withoutBlock = source.replace(CLARIFY_JSON_BLOCK_RE, "").trim();
    const fallbackQuestion = withoutBlock.split(/\r?\n/).find(Boolean) || "";

    const parsed = parseClarifyJsonObject(blockMatch[1]);

    const payload = sanitizeClarifyPayload(parsed || {}, fallbackQuestion);
    if (payload) {
      return {
        payload,
        cleanedText: withoutBlock || payload.question,
      };
    }

    return {
      payload: null,
      cleanedText: withoutBlock || source.trim(),
    };
  }

  const markerIndex = findClarifyMarkerStart(source);
  if (markerIndex >= 0) {
    const visibleText = source.slice(0, markerIndex).trim();
    const markerTail = source.slice(markerIndex);
    const openMarkerMatch = markerTail.match(CLARIFY_JSON_OPEN_RE);
    const afterMarker = openMarkerMatch
      ? markerTail.slice((openMarkerMatch.index || 0) + openMarkerMatch[0].length)
      : markerTail;
    const markerPayloadText = afterMarker.replace(CLARIFY_JSON_CLOSE_RE, "").trim();
    const fallbackQuestion = visibleText.split(/\r?\n/).find(Boolean) || "";

    const parsed = parseClarifyJsonObject(markerPayloadText);
    const payload = sanitizeClarifyPayload(parsed || {}, fallbackQuestion);
    if (payload) {
      return {
        payload,
        cleanedText: visibleText || payload.question,
      };
    }

    const combinedFallbackSource = [visibleText, markerPayloadText]
      .filter(Boolean)
      .join("\n");
    const fallbackFromCombined = parsePlainTextClarificationFallback(
      combinedFallbackSource,
    );
    if (fallbackFromCombined) {
      return {
        payload: fallbackFromCombined.payload,
        cleanedText: visibleText || fallbackFromCombined.cleanedText,
      };
    }

    return {
      payload: null,
      cleanedText: visibleText,
    };
  }

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

  const markerIndex = findClarifyMarkerStart(source);
  if (markerIndex >= 0) {
    return {
      text: source.slice(0, markerIndex).trimEnd(),
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

let token = null;
let user = null;
let currentChatId = null;
let messages = [];
let isSending = false;
let abortController = null;
let selectedModel = "qwen3-vl:2b-instruct";
let aiStyle = "formal";
let internetAccess = true;
let imageFile = null;
let imagePreview = null;
let sidebarOpen = false;
let pendingClarifyReply = false;
let clarifyPopupTimer = null;
let activeClarifyPopup = null;
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
  return activeClarifyPopup?.freeformPlaceholder || getLocalizedIdeaPlaceholder();
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
  btnPlus.title = popupMode ? getLocalizedIdeaPlaceholder() : tr("chat.options");
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

function updateInternetToggleUI() {
  if (btnToggleInternet) {
    btnToggleInternet.classList.toggle("active-toggle", internetAccess);
    btnToggleInternet.setAttribute(
      "title",
      internetAccess ? tr("chat.internetOn") : tr("chat.internetOff"),
    );
  }
}

function clearQueuedClarifyPopup() {
  if (!clarifyPopupTimer) return;
  clearTimeout(clarifyPopupTimer);
  clarifyPopupTimer = null;
}

function queueClarifyPopup(payload, options = {}) {
  if (!payload) return;
  const immediate = options?.immediate === true;
  clearQueuedClarifyPopup();
  clarifyPopupTimer = setTimeout(() => {
    clarifyPopupTimer = null;
    openClarifyPopup(payload);
  }, immediate ? 0 : CLARIFY_POPUP_DELAY_MS);
}

function hideClarifyPopup() {
  clearQueuedClarifyPopup();
  if (!clarifyPopup) return;
  activeClarifyPopup = null;
  clarifyPopup.classList.add("hidden");
  clarifyPopup.setAttribute("aria-hidden", "true");
  if (clarifyPopupOptions) clarifyPopupOptions.innerHTML = "";
  if (clarifyPopupQuestion) clarifyPopupQuestion.textContent = "";
  if (clarifyPopupStep) {
    clarifyPopupStep.textContent = "";
    clarifyPopupStep.classList.add("hidden");
  }
  updateMainInputPlaceholder();
  updateInputIconState();
  updateModelButtonState();
}

function sendClarifyReply(rawValue = "") {
  const value = String(rawValue || "").trim();
  if (!value || isSending) return;

  hideClarifyPopup();
  pendingClarifyReply = true;
  chatInput.value = value;
  chatInput.dispatchEvent(new Event("input", { bubbles: true }));
  void sendMessage();
}

function openClarifyPopup(payload) {
  if (!clarifyPopup || !payload?.question || !Array.isArray(payload?.options))
    return;

  clearQueuedClarifyPopup();
  activeClarifyPopup = payload;
  clarifyPopupQuestion.textContent = payload.question;
  clarifyPopup.setAttribute("aria-label", payload.question);

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

  clarifyPopupOptions.innerHTML = "";
  payload.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clarify-popup-option";

    const badge = document.createElement("span");
    badge.className = "clarify-popup-option-badge";
    badge.textContent = String(index + 1);

    const label = document.createElement("span");
    label.className = "clarify-popup-option-label";
    label.textContent = option.label;

    button.appendChild(badge);
    button.appendChild(label);
    button.addEventListener("click", () => {
      const optionReply = /^[A-E]$/.test(option.id)
        ? `${option.id}) ${option.label}`
        : option.label;
      const quickReply = formatClarifyReply(payload.question, optionReply);
      sendClarifyReply(quickReply);
    });

    clarifyPopupOptions.appendChild(button);
  });

  clarifyPopup.classList.remove("hidden");
  clarifyPopup.setAttribute("aria-hidden", "false");
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
  void preloadModel(selectedModel);

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
  updateModelButtonState();
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

function normalizeForContextMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
        if (content.length > 4500) content = content.slice(0, 4500);

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

  const clarifyReplyFromPopup = isClarifyPopupOpen();
  const requestText = clarifyReplyFromPopup
    ? formatClarifyReply(activeClarifyPopup?.question, text)
    : text;

  if (clarifyReplyFromPopup) {
    pendingClarifyReply = true;
  }
  hideClarifyPopup();

  isSending = true;
  chatInput.value = "";
  chatInput.style.height = "auto";
  btnSend.classList.add("hidden");
  btnStop.classList.remove("hidden");
  btnSend.disabled = true;

  let imageUrl = null;
  const fileCopy = imageFile;
  let pageContext = null;

  const page = await getActivePageContext();
  const shouldUsePageContext = shouldAttachWebsiteContext(requestText, page);
  const explicitlyAskedForPage =
    WEBSITE_SUMMARY_PROMPT_RE.test(requestText) ||
    PAGE_REFERENCE_PROMPT_RE.test(requestText);

  if (shouldUsePageContext && page?.content) {
    pageContext = {
      title: String(page.title || "").trim(),
      url: String(page.url || "").trim(),
      content: String(page.content || "").trim(),
    };
  } else if (explicitlyAskedForPage) {
    toast(tr("chat.readPageFailed"), "error");
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
    ? `![${tr("chat.image")}](${imageUrl})\n\n${requestText}`
    : requestText;
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

    const clarifyReply = pendingClarifyReply;
    pendingClarifyReply = false;
    if (clarifyReply) {
      fd.append("clarifyReply", "true");
    }

    if (pageContext) {
      fd.append("pageContext", JSON.stringify(pageContext));
      fd.append("preferPageContext", "true");
    }
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
    const clarifyForced =
      res.headers.get("X-Wieland-Clarify-Forced") === "1";

    if (memorySaved && memoryCount > 0) {
      toast(tr("chat.memorySaved", { count: memoryCount }), "success");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });

      const preview = getClarificationStreamPreview(fullText);
      const previewText = preview.text;

      updateMessage(aiId, previewText);
      scrollToBottom();
    }

    const clarification = extractClarificationPayload(fullText);
    const shouldClientForceClarify =
      clarifyForced || isLikelyVagueBuildPromptClient(requestText);
    const fallbackClarificationPayload = shouldClientForceClarify
      ? sanitizeClarifyPayload(
          buildClientForcedClarificationFallbackPayload(requestText),
          "",
        )
      : null;
    const clarificationPayload =
      clarification.payload || fallbackClarificationPayload;
    const finalAssistantText =
      clarification.cleanedText || fullText || tr("chat.shortError");

    if (finalAssistantText !== fullText) {
      fullText = finalAssistantText;
      updateMessage(aiId, finalAssistantText);
      scrollToBottom();
    }

    if (clarificationPayload) {
      queueClarifyPopup(clarificationPayload, {
        immediate: shouldClientForceClarify,
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

function updateMessage(id, content) {
  const msg = messages.find((m) => m.id === id);
  if (msg) msg.content = content;
  const el = document.querySelector(`[data-msg-id="${id}"] .message-bubble`);
  if (el) {
    el.innerHTML = content ? renderMarkdown(content) : typingLoaderHTML();
    bindCodeCopyButtons(el);
  }
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
    fd.append("internetAccess", internetAccess ? "true" : "false");
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
    const clarifyForced =
      res.headers.get("X-Wieland-Clarify-Forced") === "1";

    if (memorySaved && memoryCount > 0) {
      toast(tr("chat.memorySaved", { count: memoryCount }), "success");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });

      const preview = getClarificationStreamPreview(fullText);
      const previewText = preview.text;

      updateMessage(aiId, previewText);
      scrollToBottom();
    }

    const clarification = extractClarificationPayload(fullText);
    const shouldClientForceClarify =
      clarifyForced || isLikelyVagueBuildPromptClient(requestText);
    const fallbackClarificationPayload = shouldClientForceClarify
      ? sanitizeClarifyPayload(
          buildClientForcedClarificationFallbackPayload(requestText),
          "",
        )
      : null;
    const clarificationPayload =
      clarification.payload || fallbackClarificationPayload;
    const finalAssistantText =
      clarification.cleanedText || fullText || tr("chat.shortError");

    if (finalAssistantText !== fullText) {
      fullText = finalAssistantText;
      updateMessage(aiId, finalAssistantText);
      scrollToBottom();
    }

    if (clarificationPayload) {
      queueClarifyPopup(clarificationPayload, {
        immediate: shouldClientForceClarify,
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
  const source = String(cleanedText || raw || "").replace(/\r\n/g, "\n");

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
