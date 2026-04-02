import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../styles/ChatInterface.css";
import Sidebar from "./Sidebar";
import AuthModal from "./AuthModal";
import { useAuth } from "../context/AuthContext";
import { withLang } from "../utils/i18nRouting";

const MAX_IMAGE_MB = 10;
const MODEL_PRELOAD_REFRESH_MS = 10 * 60 * 1000;
const CLARIFY_POPUP_DELAY_MS = 240;

function normalizeUiLang(value = "") {
  const lang = String(value || "").toLowerCase();
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("it")) return "it";
  return "de";
}

function getLocalizedIdeaPlaceholder(language = "de") {
  const lang = normalizeUiLang(language);
  if (lang === "en") return "Describe your idea";
  if (lang === "it") return "Descrivi la tua idea";
  return "Beschreibe deine Idee";
}

function getLocalizedSkipLabel(language = "de") {
  const lang = normalizeUiLang(language);
  if (lang === "en") return "Skip";
  if (lang === "it") return "Salta";
  return "Überspringen";
}

const TargetIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);
const LightningIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);
const BotIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <path d="M12 4v4" />
    <circle cx="9" cy="14" r="1" />
    <circle cx="15" cy="14" r="1" />
  </svg>
);
const SparkIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);
const GlobeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14.5 14.5 0 0 1 0 18" />
    <path d="M12 3a14.5 14.5 0 0 0 0 18" />
  </svg>
);

const AVAILABLE_MODELS = [
  { id: "qwen3-vl:2b-instruct", key: "chat.models.free", icon: <BotIcon /> },
  {
    id: "qwen3-vl:4b-instruct",
    key: "chat.models.pro",
    icon: <LightningIcon />,
  },
  {
    id: "qwen3-vl:8b-instruct",
    key: "chat.models.precise",
    icon: <TargetIcon />,
  },
];

const normalizePlan = (plan) => {
  const value = String(plan || "Free").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "max") return "max";
  if (value === "pro") return "pro";
  return "free";
};

const getPlanRank = (plan) => {
  const normalized = normalizePlan(plan);
  if (normalized === "admin" || normalized === "max") return 2;
  if (normalized === "pro") return 1;
  return 0;
};

const getModelRank = (modelId) => {
  if (modelId === "qwen3-vl:8b-instruct") return 2;
  if (modelId === "qwen3-vl:4b-instruct") return 1;
  return 0;
};

const getPlanModel = (plan) => {
  const normalized = normalizePlan(plan);
  if (normalized === "admin" || normalized === "max")
    return "qwen3-vl:8b-instruct";
  if (normalized === "pro") return "qwen3-vl:4b-instruct";
  return "qwen3-vl:2b-instruct";
};

const AI_STYLES = [
  { id: "formal", key: "chat.styles.formal", icon: <BotIcon /> },
  { id: "friendly", key: "chat.styles.friendly", icon: <BotIcon /> },
  { id: "precise", key: "chat.styles.precise", icon: <SparkIcon /> },
];

const CLARIFY_JSON_BLOCK_RE =
  /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]([\s\S]*?)\[\[\s*\/\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_OPEN_RE =
  /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_CLOSE_RE =
  /\[\[\s*\/\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_TOKEN_RE = /WIELAND[\s_-]*CLARIFY[\s_-]*JSON/i;
const CLARIFY_OPTION_LINE_RE = /^\s*([A-E])[)\].:-]\s*(.+)$/i;
const CLARIFY_OPTION_IDS = ["A", "B", "C", "D", "E"];
const CLARIFY_VAGUE_BUILD_VERB_RE =
  /\b(mach|mache|build|make|create|generate|generat|generier|erstell\w*|baue?\b|program\w*|entwickl\w*|crea|sviluppa|fai)\b/i;
const CLARIFY_VAGUE_BUILD_TARGET_RE =
  /\b(app|website|webseite|landing\s+page|tool|projekt|project|bot|script|programm|program|dashboard|automation|automatisierung|extension)\b/i;
const CLARIFY_VAGUE_BUILD_SCOPE_HINT_RE =
  /\b(react|vue|svelte|html|css|javascript|typescript|node|python|java|single\s+file|mehrere\s+dateien|backend|frontend|api|mobile|ios|android|chrome\s+extension|browser\s+extension|deadline|budget|zielgruppe|target\s+audience)\b/i;

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
          "Something else",
      ).trim() || "Something else",
    skipLabel: String(payload?.skipLabel || "Skip").trim() || "Skip",
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
    `<button type="button" class="code-copy-btn" data-code="${payload}">Copy</button>`,
    "</div>",
    `<pre><code>${escapeHtmlText(code)}</code></pre>`,
    "</div>",
  ].join("");
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
    .replace(/\*\*(.*?)\*\*/gs, "<strong>$1</strong>")
    .replace(/__(.*?)__/gs, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gs, "<em>$1</em>")
    .replace(/_(.*?)_/gs, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[(.*?)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br />");

  html = html.replace(/((?:<li>.*?<\/li>(?:<br \/>)?)+)/g, "<ul>$1</ul>");
  html = html.replace(
    /<ul>(.*?)<\/ul>/gs,
    (_full, inner) => `<ul>${String(inner || "").replace(/<br \/>/g, "")}</ul>`,
  );

  return html;
}

const stripImg = (text = "") =>
  extractClarificationPayload(
    text.replace(/!\[.*?\]\([^)]+\)\n\n?/g, "").trim(),
  ).cleanedText;

const toContextContent = (text = "") =>
  String(text || "")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (full, rawUrl) => {
      const url = String(rawUrl || "").trim();
      return /\/history\/images\//.test(url) ? full : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function extractImageUrl(content = "") {
  const m = content.match(/!\[.*?\]\(([^)]+)\)/);
  return m ? m[1] : null;
}

function pushUrl(url) {
  if (window.location.pathname !== url) window.history.pushState(null, "", url);
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const ImageIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

export default function ChatInterface({
  onMessagesChange,
  chatId,
  isLoading = false,
  sidebarOpen,
  onSidebarChange,
  inputOffset = 50,
  onNewChatRef,
  onLoadChatRef,
}) {
  const { t, i18n } = useTranslation();
  const DEMO_MODE = true;
  const { authFetch, user } = useAuth();
  const localPath = (path) => withLang(path, i18n.language);

  const isModelAllowed = (modelId, plan = "Free") => {
    return getModelRank(modelId) <= getPlanRank(plan);
  };

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [currentChatId, setCurrentChatId] = useState(chatId || null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [selectedModel, setSelectedModel] = useState(getPlanModel(user?.plan));
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [aiStyle, setAiStyle] = useState("formal");
  const [toast, setToast] = useState(null);
  const [clarifyPopup, setClarifyPopup] = useState(null);
  const [internetAccess, setInternetAccess] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.localStorage.getItem("wieland_internet_access");
      if (stored == null) return true;
      return stored === "1" || stored === "true";
    } catch {
      return true;
    }
  });
  const pendingInputRef = useRef("");

  useEffect(() => {
    setSelectedModel(getPlanModel(user?.plan));
  }, [user?.plan]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "wieland_internet_access",
        internetAccess ? "1" : "0",
      );
    } catch {}
  }, [internetAccess]);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const editInputRef = useRef(null);
  const abortRef = useRef(null);
  const currentChatRef = useRef(currentChatId);
  const plusMenuRef = useRef(null);
  const modelDropdownRef = useRef(null);
  const modelWarmUntilRef = useRef({});
  const toastTimeoutRef = useRef(null);
  const sendMessageRef = useRef(null);
  const pendingClarifyReplyRef = useRef(false);
  const clarifyPopupTimeoutRef = useRef(null);

  const clearQueuedClarifyPopup = useCallback(() => {
    if (!clarifyPopupTimeoutRef.current) return;
    clearTimeout(clarifyPopupTimeoutRef.current);
    clarifyPopupTimeoutRef.current = null;
  }, []);

  const queueClarifyPopup = useCallback(
    (payload, options = {}) => {
      if (!payload) return;
      const immediate = options?.immediate === true;
      clearQueuedClarifyPopup();
      clarifyPopupTimeoutRef.current = setTimeout(() => {
        setClarifyPopup(payload);
        clarifyPopupTimeoutRef.current = null;
      }, immediate ? 0 : CLARIFY_POPUP_DELAY_MS);
    },
    [clearQueuedClarifyPopup],
  );

  const showToast = useCallback((message, type = "success") => {
    if (!message) return;
    setToast({ message, type, id: Date.now() });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      clearQueuedClarifyPopup();
    };
  }, [clearQueuedClarifyPopup]);

  const welcomeMessage = useMemo(() => {
    const welcomeMessages = t("chat.welcome", { returnObjects: true });
    const items = Array.isArray(welcomeMessages)
      ? welcomeMessages
      : [String(welcomeMessages)];
    return items[Math.floor(Math.random() * items.length)];
  }, [i18n.language, t]);

  useEffect(() => {
    currentChatRef.current = currentChatId;
  }, [currentChatId]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    onMessagesChange?.(messages.length > 0);
  }, [messages, onMessagesChange]);
  useEffect(() => {
    if (chatId) loadChat(chatId);
  }, [chatId]);
  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);
  useEffect(() => {
    onNewChatRef?.(handleNewChat);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target)
      )
        setShowModelDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target))
        setShowPlusMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!clarifyPopup) return;
    setShowPlusMenu(false);
    setShowModelDropdown(false);
  }, [clarifyPopup]);

  const uploadImage = useCallback(
    async (file) => {
      const fd = new FormData();
      fd.append("image", file);
      const res = await authFetch("/api/history/upload-image", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
      return (await res.json()).url;
    },
    [authFetch],
  );

  const preloadModel = useCallback(
    async (modelId) => {
      if (!user || !modelId) return;

      const now = Date.now();
      const warmUntil = modelWarmUntilRef.current[modelId] || 0;
      if (warmUntil > now) return;

      try {
        const res = await authFetch("/api/chat/preload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId }),
        });

        if (res.ok) {
          modelWarmUntilRef.current[modelId] = now + MODEL_PRELOAD_REFRESH_MS;
        }
      } catch {}
    },
    [authFetch, user],
  );

  useEffect(() => {
    if (!user) return;
    preloadModel(selectedModel);
  }, [user, selectedModel, preloadModel]);

  const loadChat = useCallback(
    async (filename) => {
      try {
        const res = await authFetch(`/api/history/${filename}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const loaded = (data.messages ?? []).map((m, i) => ({
          content: m.content,
          isUser: m.role === "user",
          id: `loaded-${i}-${uid()}`,
        }));
        setMessages(loaded);
        setCurrentChatId(filename);
        const uuid = filename.match(/chat_([a-f0-9-]+)\.json/)?.[1];
        if (uuid) pushUrl(localPath(`/chat/${uuid}`));
      } catch (err) {
        console.error("Failed to load chat:", err);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    onLoadChatRef?.(loadChat);
  }, [loadChat]);

  const saveChat = useCallback(
    async (msgs, chatIdToUse, generateTitle = false) => {
      if (!msgs.length) return;
      try {
        const res = await authFetch("/api/history/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs.map((m) => ({
              role: m.isUser ? "user" : "assistant",
              content: m.content,
            })),
            filename: chatIdToUse ?? undefined,
            generateTitle,
          }),
        });
        if (!res.ok) {
          console.error("Save failed:", res.status);
          return;
        }
        const saved = await res.json();
        if (saved.filename && !chatIdToUse) {
          setCurrentChatId(saved.filename);
          currentChatRef.current = saved.filename;
          const uuid = saved.filename.match(/chat_([a-f0-9-]+)\.json/)?.[1];
          if (uuid) pushUrl(localPath(`/chat/${uuid}`));
        }
        window.dispatchEvent(new CustomEvent("chatHistoryUpdated"));
      } catch (err) {
        console.error("Failed to save chat:", err);
      }
    },
    [authFetch],
  );

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert(t("chat.errors.notImage", { name: file.name }));
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      alert(t("chat.errors.tooLarge", { max: MAX_IMAGE_MB }));
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) =>
      setImagePreview({ dataUrl: ev.target.result, name: file.name });
    reader.readAsDataURL(file);
    setShowPlusMenu(false);
    e.target.value = "";
  };

  const clearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim() || (imageFile ? t("chat.describeImage") : "");
    if (!text || isSending) return;

    const clarifyReplyFromPopup = Boolean(clarifyPopup);
    const requestText = clarifyReplyFromPopup
      ? formatClarifyReply(clarifyPopup?.question, text)
      : text;

    clearQueuedClarifyPopup();
    setClarifyPopup(null);

    if (!user) {
      pendingInputRef.current = requestText;
      setAuthModalOpen(true);
      return;
    }

    if (clarifyReplyFromPopup) {
      pendingClarifyReplyRef.current = true;
    }

    setIsSending(true);
    setInput("");

    let imageUrl = null;
    const fileCopy = imageFile;
    if (fileCopy) {
      clearImage();
      try {
        imageUrl = await uploadImage(fileCopy);
      } catch (err) {
        console.error("Image upload failed:", err);
        imageUrl = imagePreview?.dataUrl ?? null;
      }
    }

    const userContext = imageUrl
      ? `![Bild](${imageUrl})\n\n${requestText}`
      : requestText;
    const userMsg = { content: userContext, isUser: true, id: uid() };

    const contextSnap = messages.map((m) => ({
      role: m.isUser ? "user" : "assistant",
      content: toContextContent(m.content),
    }));

    const withUser = [...messages, userMsg];
    setMessages(withUser);

    await runStream(
      requestText,
      fileCopy,
      contextSnap,
      withUser,
      selectedModel,
      aiStyle,
      internetAccess,
    );
  }, [
    input,
    imageFile,
    imagePreview,
    isSending,
    messages,
    user,
    clearImage,
    selectedModel,
    aiStyle,
    internetAccess,
    uploadImage,
    clearQueuedClarifyPopup,
    clarifyPopup,
  ]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const handleAuthSuccess = useCallback(() => {
    if (pendingInputRef.current) {
      setInput(pendingInputRef.current);
      pendingInputRef.current = "";
      setTimeout(() => {}, 50);
    }
  }, []);

  const sendClarifyReply = useCallback(
    (rawReply) => {
      const reply = String(rawReply || "").trim();
      if (!reply || isSending) return;

      clearQueuedClarifyPopup();
      setClarifyPopup(null);
      pendingClarifyReplyRef.current = true;
      setInput(reply);

      setTimeout(() => {
        sendMessageRef.current?.();
      }, 0);
    },
    [isSending, clearQueuedClarifyPopup],
  );

  const runStream = useCallback(
    async (
      userText,
      file,
      contextSnap,
      baseMessages,
      model = AVAILABLE_MODELS[0].id,
      style = "formal",
      useInternet = false,
    ) => {
      const aiId = uid();
      setMessages((prev) => [
        ...prev,
        { content: "", isUser: false, id: aiId },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      let fullText = "";

      try {
        const fd = new FormData();
        fd.append("message", userText);
        fd.append("context", JSON.stringify(contextSnap));
        fd.append("model", model);
        fd.append("aiStyle", style);
        fd.append("internetAccess", useInternet ? "true" : "false");

        const clarifyReply = pendingClarifyReplyRef.current;
        pendingClarifyReplyRef.current = false;
        if (clarifyReply) {
          fd.append("clarifyReply", "true");
        }

        if (file) fd.append("image", file);

        const token = localStorage.getItem("wieland_token");
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers,
          body: fd,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`API ${res.status}`);

        const memorySaved =
          res.headers.get("X-Wieland-Memory-Saved") === "1";
        const memoryCount = Number(
          res.headers.get("X-Wieland-Memory-Count") || "0",
        );
        const clarifyForced =
          res.headers.get("X-Wieland-Clarify-Forced") === "1";

        if (memorySaved && memoryCount > 0) {
          showToast(t("chat.memorySaved", { count: memoryCount }), "success");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });

          const preview = getClarificationStreamPreview(fullText);
          const previewText = preview.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId ? { ...m, content: previewText } : m,
            ),
          );
        }

        const clarification = extractClarificationPayload(fullText);
        const shouldClientForceClarify =
          clarifyForced || isLikelyVagueBuildPromptClient(userText);
        const fallbackClarificationPayload = shouldClientForceClarify
          ? sanitizeClarifyPayload(
              buildClientForcedClarificationFallbackPayload(userText),
              "",
            )
          : null;
        const clarificationPayload =
          clarification.payload || fallbackClarificationPayload;
        const finalAssistantText =
          clarification.cleanedText || fullText || t("chat.shortError");

        if (finalAssistantText !== fullText) {
          fullText = finalAssistantText;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId ? { ...m, content: finalAssistantText } : m,
            ),
          );
        }

        if (clarificationPayload) {
          queueClarifyPopup(clarificationPayload, {
            immediate: shouldClientForceClarify,
          });
        }

        const final = [...baseMessages];
        if (finalAssistantText) {
          final.push({ content: finalAssistantText, isUser: false, id: aiId });
        }
        const isNew = !currentChatRef.current && final.length <= 2;
        await saveChat(final, currentChatRef.current, isNew);
      } catch (err) {
        if (err.name === "AbortError") {
          if (currentChatRef.current) {
            await saveChat(
              [...baseMessages, { content: fullText, isUser: false, id: aiId }],
              currentChatRef.current,
              false,
            );
          }
          return;
        }
        console.error("Stream error:", err);
        const fallback = DEMO_MODE
          ? t("chat.demoFallback")
          : t("chat.errors.server");
        setMessages((prev) =>
          prev.map((m) => (m.id === aiId ? { ...m, content: fallback } : m)),
        );
      } finally {
        abortRef.current = null;
        setIsSending(false);
      }
    },
    [saveChat, showToast, t, queueClarifyPopup],
  );

  const stopGeneration = () => abortRef.current?.abort();

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isSending) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    clearQueuedClarifyPopup();
    setMessages([]);
    setClarifyPopup(null);
    setCurrentChatId(null);
    currentChatRef.current = null;
    setInput("");
    clearImage();
    setEditingId(null);
    pushUrl(localPath("/"));
  }, [clearImage, clearQueuedClarifyPopup]);

  const lastUserMsg = messages.reduce((last, m) => (m.isUser ? m : last), null);

  const startEditing = (msg) => {
    if (msg.id !== lastUserMsg?.id) return;
    setEditingId(msg.id);
    setEditingText(stripImg(msg.content));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async (msgId) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    const orig = messages[idx];
    const imgUrl = extractImageUrl(orig.content);
    const newContent = imgUrl
      ? `![Bild](${imgUrl})\n\n${editingText}`
      : editingText;

    const updated = messages.map((m, i) =>
      i === idx ? { ...m, content: newContent } : m,
    );
    const truncated = updated.slice(0, idx + 1);

    setMessages(truncated);
    setEditingId(null);

    const hadAI = idx < messages.length - 1 && !messages[idx + 1]?.isUser;

    if (hadAI) {
      setIsSending(true);
      const ctx = truncated.slice(0, idx).map((m) => ({
        role: m.isUser ? "user" : "assistant",
        content: toContextContent(m.content),
      }));
      let refile = null;
      if (imgUrl) {
        try {
          const blob = await fetch(imgUrl).then((r) => r.blob());
          refile = new File([blob], "image.jpg", {
            type: blob.type || "image/jpeg",
          });
        } catch (err) {
          console.error("Failed to restore image for edit stream:", err);
        }
      }
      const requestText = refile ? editingText : toContextContent(newContent);
      await runStream(
        requestText,
        refile,
        ctx,
        truncated,
        selectedModel,
        aiStyle,
        internetAccess,
      );
    } else {
      if (currentChatRef.current)
        await saveChat(truncated, currentChatRef.current, false);
    }
  };

  const regenerate = useCallback(async () => {
    if (isSending || !messages.length) return;
    const aiIdx = [...messages].reduceRight(
      (found, m, i) => (found === -1 && !m.isUser ? i : found),
      -1,
    );
    if (aiIdx === -1) return;
    const uIdx = messages
      .slice(0, aiIdx)
      .reduceRight((f, m, i) => (f === -1 && m.isUser ? i : f), -1);
    if (uIdx === -1) return;

    const uMsg = messages[uIdx];
    const imgUrl = extractImageUrl(uMsg.content);
    const truncated = messages.slice(0, aiIdx);
    setMessages(truncated);
    setIsSending(true);

    const ctx = truncated.slice(0, uIdx).map((m) => ({
      role: m.isUser ? "user" : "assistant",
      content: toContextContent(m.content),
    }));
    let refile = null;
    if (imgUrl) {
      try {
        const blob = await fetch(imgUrl).then((r) => r.blob());
        refile = new File([blob], "image.jpg", {
          type: blob.type || "image/jpeg",
        });
      } catch (err) {
        console.error("Failed to restore image for regenerate stream:", err);
      }
    }
    const requestText = refile
      ? stripImg(uMsg.content)
      : toContextContent(uMsg.content);
    await runStream(
      requestText,
      refile,
      ctx,
      truncated,
      selectedModel,
      aiStyle,
      internetAccess,
    );
  }, [messages, isSending, runStream, selectedModel, aiStyle, internetAccess]);

  const copyText = useCallback(
    async (content) => {
      try {
        await navigator.clipboard.writeText(stripImg(content));
        showToast(t("chat.copied"), "success");
      } catch (err) {
        console.error(err);
        showToast(t("chat.errors.server"), "error");
      }
    },
    [showToast, t],
  );

  const copyCode = useCallback(
    async (encodedCode) => {
      const decoded = decodeCodePayload(encodedCode);
      if (!decoded) return;
      try {
        await navigator.clipboard.writeText(decoded);
        showToast(t("chat.copied"), "success");
      } catch (err) {
        console.error(err);
        showToast(t("chat.errors.server"), "error");
      }
    },
    [showToast, t],
  );

  return (
    <div
      className={`chat-interface-wrapper ${isLoading ? "loading" : ""}`}
      style={{ "--chat-input-offset": `${inputOffset}px` }}
    >
      {user && (
        <Sidebar
          onNewChat={handleNewChat}
          onDeleteChat={(id) => {
            if (id === currentChatId) handleNewChat();
          }}
          onLoadChat={(filename) => loadChat(filename)}
          currentChatId={currentChatId}
          isOpen={sidebarOpen}
          onOpenChange={onSidebarChange}
        />
      )}

      <div className="chat-container">
        <div className="messages-area">
          {messages.length === 0 ? (
            <div
              className="welcome-message-container"
              style={{ bottom: `${inputOffset + 104}px` }}
            >
              <span>{welcomeMessage}</span>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                isLast={idx === messages.length - 1}
                isLastUser={msg.id === lastUserMsg?.id}
                isEditing={editingId === msg.id}
                editingText={editingText}
                editInputRef={editInputRef}
                isSending={isSending}
                onEdit={startEditing}
                onEditChange={setEditingText}
                onEditSave={saveEdit}
                onEditCancel={cancelEdit}
                onCopy={copyText}
                onCopyCode={copyCode}
                onRegenerate={regenerate}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div
          className={`chat-input-container ${imagePreview ? "has-preview" : ""}`}
          style={{ bottom: `${inputOffset}px` }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />

          {imagePreview && (
            <div className="image-previews-container">
              <div className="image-file-pill">
                <div className="image-file-icon">
                  <img src={imagePreview.dataUrl} alt={imagePreview.name} />
                </div>
                <div className="image-file-meta">
                  <div className="image-file-name">{imagePreview.name}</div>
                  <div className="image-file-type">{t("chat.image")}</div>
                </div>
                <button
                  className="image-file-remove"
                  onClick={clearImage}
                  aria-label={t("chat.removeImage")}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {showPlusMenu && (
            <div className="plus-popup" ref={plusMenuRef}>
              <button
                className="plus-popup-item"
                onClick={() => {
                  fileInputRef.current?.click();
                  setShowPlusMenu(false);
                }}
              >
                <ImageIcon /> {t("chat.imageUpload")}
              </button>
              <div className="plus-popup-divider" />
              <button
                className={`plus-popup-item plus-popup-toggle ${internetAccess ? "active" : ""}`}
                onClick={() => setInternetAccess((prev) => !prev)}
              >
                <GlobeIcon /> {t("chat.internetAccess")}
              </button>
              <div className="plus-popup-divider" />
              <div className="plus-popup-section-title">
                {t("chat.aiStyle")}
              </div>
              {AI_STYLES.map((style) => (
                <button
                  key={style.id}
                  className={`plus-popup-item ${aiStyle === style.id ? "active" : ""}`}
                  onClick={() => {
                    setAiStyle(style.id);
                    setShowPlusMenu(false);
                  }}
                >
                  {style.icon} {t("chat.aiStyle")}: {t(style.key)}
                </button>
              ))}
            </div>
          )}

          {clarifyPopup && (
            <ClarifyPopup
              key={`${clarifyPopup.question}-${clarifyPopup.step || 0}-${clarifyPopup.totalSteps || 0}`}
              data={clarifyPopup}
              onSelect={sendClarifyReply}
            />
          )}

          <div
            className="input-row"
            onClick={() => showPlusMenu && setShowPlusMenu(false)}
          >
            <button
              className={`icon-btn plus-btn ${clarifyPopup ? "input-deco-btn" : ""}`}
              onClick={(e) => {
                if (clarifyPopup) return;
                e.stopPropagation();
                setShowPlusMenu((v) => !v);
              }}
              disabled={isSending || Boolean(clarifyPopup)}
              aria-label={clarifyPopup ? getLocalizedIdeaPlaceholder(i18n.language) : t("chat.options")}
            >
              {clarifyPopup ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              )}
            </button>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !user
                  ? t("chat.placeholderLogin")
                  : imagePreview
                    ? t("chat.placeholderImage")
                    : clarifyPopup
                      ? (clarifyPopup.freeformPlaceholder ||
                        getLocalizedIdeaPlaceholder(i18n.language))
                      : t("chat.placeholderMessage")
              }
              disabled={isSending}
              className="chat-input-bottom"
              rows={1}
            />

            <div className="model-selector-wrapper" ref={modelDropdownRef}>
              {clarifyPopup ? (
                <button
                  className="model-selector-btn popup-skip-btn"
                  onClick={() => {
                    clearQueuedClarifyPopup();
                    setClarifyPopup(null);
                  }}
                  disabled={isSending}
                >
                  {getLocalizedSkipLabel(i18n.language)}
                </button>
              ) : (
                <>
                  <button
                    className={`model-selector-btn ${showModelDropdown ? "open" : ""}`}
                    onClick={() => setShowModelDropdown((v) => !v)}
                    disabled={isSending}
                  >
                    <span className="model-selector-label">
                      {AVAILABLE_MODELS.find((m) => m.id === selectedModel)
                        ? t(
                            AVAILABLE_MODELS.find((m) => m.id === selectedModel)
                              .key,
                          )
                        : selectedModel}
                    </span>
                    <svg
                      className="model-selector-arrow"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {showModelDropdown && (
                    <div className="model-dropdown">
                      {AVAILABLE_MODELS.map((m) => {
                        const allowed = isModelAllowed(m.id, user?.plan);
                        return (
                          <button
                            key={m.id}
                            className={`model-dropdown-item ${selectedModel === m.id ? "active" : ""} ${!allowed ? "disabled" : ""}`}
                            onClick={() => {
                              if (allowed) {
                                setSelectedModel(m.id);
                                setShowModelDropdown(false);
                              }
                            }}
                            disabled={!allowed}
                            title={!allowed ? t("chat.planModelLocked") : ""}
                          >
                            <span>{m.icon}</span> {t(m.key)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              className={`icon-btn ${isSending ? "stop-btn" : "send-btn"}`}
              onClick={isSending ? stopGeneration : sendMessage}
              disabled={!isSending && !input.trim() && !imagePreview}
              aria-label={isSending ? t("common.stop") : t("common.send")}
            >
              {isSending ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="6" y="6" width="12" height="12" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {toast && <div className={`chat-toast ${toast.type}`}>{toast.message}</div>}

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          pendingInputRef.current = "";
        }}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}

function ClarifyPopup({ data, onSelect }) {
  if (!data) return null;

  const options = Array.isArray(data.options) ? data.options : [];
  const stepLabel =
    data.step && data.totalSteps && data.totalSteps > 1
      ? `${data.step} von ${data.totalSteps}`
      : "";

  return (
    <div className="clarify-dock" role="dialog" aria-label={data.question}>
      <div className="clarify-dock-card">
        <div className="clarify-dock-head">
          <h3>{data.question}</h3>
        </div>

        {stepLabel && <div className="clarify-dock-step">{stepLabel}</div>}

        <div className="clarify-dock-options">
          {options.map((option, index) => {
            const optionReply = /^[A-E]$/.test(option.id)
              ? `${option.id}) ${option.label}`
              : option.label;
            const quickReply = formatClarifyReply(data.question, optionReply);

            return (
              <button
                key={`${option.id}-${index}`}
                className="clarify-dock-option"
                onClick={() => onSelect(quickReply)}
              >
                <span className="clarify-dock-option-index">{index + 1}</span>
                <span className="clarify-dock-option-label">{option.label}</span>
                <span className="clarify-dock-option-arrow">›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  msg,
  isLast,
  isLastUser,
  isEditing,
  editingText,
  editInputRef,
  isSending,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onCopy,
  onCopyCode,
  onRegenerate,
}) {
  const { t } = useTranslation();
  const imageUrl = extractImageUrl(msg.content);
  const textOnly = stripImg(msg.content);

  const handleAssistantContentClick = (event) => {
    const button = event.target.closest(".code-copy-btn");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    onCopyCode?.(button.getAttribute("data-code") || "");
  };

  return (
    <div className={`message ${msg.isUser ? "user-message" : "ai-message"}`}>
      <div className="message-bubble">
        {isEditing ? (
          <div className="edit-message-container">
            <textarea
              ref={editInputRef}
              value={editingText}
              onChange={(e) => onEditChange(e.target.value)}
              className="edit-message-input"
              rows={3}
            />
            <div className="edit-actions">
              <button
                className="edit-save-btn"
                onClick={() => onEditSave(msg.id)}
              >
                {t("common.save")}
              </button>
              <button className="edit-cancel-btn" onClick={onEditCancel}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {msg.isUser ? (
              <div>
                {imageUrl && (
                  <div className="message-images-grid">
                    <img
                      src={imageUrl}
                      alt={t("chat.imageAlt")}
                      className="message-image"
                    />
                  </div>
                )}
                {textOnly && <span>{textOnly}</span>}
              </div>
            ) : msg.content === "" ? (
              <TypingLoader />
            ) : (
              <div
                onClick={handleAssistantContentClick}
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(msg.content),
                }}
              />
            )}
          </>
        )}
      </div>

      {!isEditing && (
        <div className="message-actions">
          {msg.isUser ? (
            <>
              {isLastUser && (
                <button
                  className="message-action-btn"
                  onClick={() => onEdit(msg)}
                  title={t("common.edit")}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 3L21 7L7 21H3V17L17 3Z" />
                  </svg>
                </button>
              )}
              <button
                className="message-action-btn"
                onClick={() => onCopy(msg.content)}
                title={t("common.copy")}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </>
          ) : (
            <>
              {msg.content && isLast && (
                <button
                  className="message-action-btn"
                  onClick={onRegenerate}
                  disabled={isSending}
                  title={t("chat.regenerate")}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M1 4v6h6" />
                    <path d="M23 20v-6h-6" />
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                  </svg>
                </button>
              )}
              {msg.content && (
                <button
                  className="message-action-btn"
                  onClick={() => onCopy(msg.content)}
                  title={t("common.copy")}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TypingLoader() {
  const { t } = useTranslation();
  return (
    <div className="loader" aria-label={t("common.loading")}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="circle">
          <div className="dot" />
          <div className="outline" />
        </div>
      ))}
    </div>
  );
}
