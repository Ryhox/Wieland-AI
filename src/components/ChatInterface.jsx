import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../styles/ChatInterface.css";
import Sidebar from "./Sidebar";
import AuthModal from "./AuthModal";
import { useAuth } from "../context/AuthContext";
import { withLang } from "../utils/i18nRouting";

const MAX_IMAGE_MB = 10;
const MODEL_PRELOAD_REFRESH_MS = 10 * 60 * 1000;
const CLARIFY_POPUP_DELAY_MS = 0;
const CLARIFY_TYPE_INTERVAL_MS = 18;
const CLARIFY_QUESTION_CHARS_PER_TICK = 1;
const CLARIFY_OPTION_CHARS_PER_TICK = 1;

// hier hängt der komplette seitenflow dran, also lieber klar halten
function normalizeUiLang(value = "") {
  const lang = String(value || "").toLowerCase();
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("it")) return "it";
  return "de";
}

// get localized idea placeholder: return language-specific placeholder text for input box
function getLocalizedIdeaPlaceholder(language = "de") {
  const lang = normalizeUiLang(language);
  if (lang === "en") return "Describe your idea";
  if (lang === "it") return "Descrivi la tua idea";
  return "Beschreibe deine Idee";
}

// get localized skip label: return language-specific label for skip button
function getLocalizedSkipLabel(language = "de") {
  const lang = normalizeUiLang(language);
  if (lang === "en") return "Skip";
  if (lang === "it") return "Salta";
  return "Überspringen";
}

// svg icon: target circle (used for model selection)
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

// svg icon: lightning bolt (used for pro model tier)
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

// svg icon: robot (used for free/basic model icon)
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

// svg icon: spark/lightning (used for AI style selector)
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

// svg icon: globe (used for internet access toggle)
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

// normalize plan: coerce plan value to canonical tier (admin/max/pro/free)
const normalizePlan = (plan) => {
  const value = String(plan || "Free").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "max") return "max";
  if (value === "pro") return "pro";
  return "free";
};

// get plan rank: numeric comparison (0=free, 1=pro, 2=admin/max)
const getPlanRank = (plan) => {
  const normalized = normalizePlan(plan);
  if (normalized === "admin" || normalized === "max") return 2;
  if (normalized === "pro") return 1;
  return 0;
};

// get model rank: numeric tier comparison (0=2b, 1=4b, 2=8b)
const getModelRank = (modelId) => {
  if (modelId === "qwen3-vl:8b-instruct") return 2;
  if (modelId === "qwen3-vl:4b-instruct") return 1;
  return 0;
};

// get plan model: return highest model available for user's plan tier
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

// regex patterns for parsing [[WIELAND_CLARIFY_JSON]] markers and extracting embedded clarification payloads
const CLARIFY_JSON_BLOCK_RE =
  /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]([\s\S]*?)\[\[\s*\/\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_OPEN_RE = /\[\[\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_CLOSE_RE =
  /\[\[\s*\/\s*WIELAND[\s_-]*CLARIFY[\s_-]*JSON\s*\]\]/i;
const CLARIFY_JSON_TOKEN_RE = /WIELAND[\s_-]*CLARIFY[\s_-]*JSON/i;
const CLARIFY_OPTION_LINE_RE = /^\s*([A-E])[)\].:-]\s*(.+)$/i;
const CLARIFY_OPTION_IDS = ["A", "B", "C", "D", "E"];

// normalize clarify label key: strip accents + whitespace to canonicalize option labels
function normalizeClarifyLabelKey(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// is disallowed clarify option label: filter out generic labels like "other", "explain", "more details"
function isDisallowedClarifyOptionLabel(value = "") {
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
}

// normalize clarify options: coerce raw option list into canonical [{id, label}] format, dedup, validate
function normalizeClarifyOptions(rawOptions = []) {
  const out = [];
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  const seenLabelKeys = new Set();

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

// to single sentence question: truncate question to 140 chars, keep only first sentence
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

// get clarify payload signature: compute stable hash of clarification payload for deduplication
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

// is clarify qa reply text: detect if text is Q: ..., A: ... format
function isClarifyQaReplyText(value = "") {
  const source = String(value || "").trim();
  if (!source) return false;

  return /^q\s*:/i.test(source) && /(?:^|\n)\s*a\s*:/im.test(source);
}

// format clarify reply: format user answer as Q: {...} A: {...} format
function formatClarifyReply(question = "", answer = "") {
  const cleanAnswer = String(answer || "").trim();
  if (!cleanAnswer) return "";
  if (isClarifyQaReplyText(cleanAnswer)) return cleanAnswer;

  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) return cleanAnswer;

  return `Q: ${cleanQuestion}\nA: ${cleanAnswer}`;
}

// find clarify marker start: detect where [[WIELAND_CLARIFY_JSON]] block begins in text
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
  if (
    tokenMatch &&
    Number.isInteger(tokenMatch.index) &&
    tokenMatch.index >= 0
  ) {
    return tokenMatch.index;
  }

  return -1;
}

// extract first json object: parse JSON from text by tracking brace depth + string literals
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

// parse clarify json object: extract JSON from fenced code blocks or raw string
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

// sanitize clarify payload: validate + normalize clarification structure (question, options, steps)
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
    skipLabel: String(payload?.skipLabel || "Skip").trim() || "Skip",
    step: hasSingleStepMeta ? 1 : null,
    totalSteps: hasSingleStepMeta ? 1 : null,
  };
}

// parse plain text clarification fallback: extract Q/A from plain text if JSON parsing fails
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

// extract clarification payload: parse [[WIELAND_CLARIFY_JSON]] blocks from response text
function extractClarificationPayload(rawText = "") {
  const source = String(rawText || "");
  if (!source) return { payload: null, cleanedText: "" };

  const blockPattern = new RegExp(CLARIFY_JSON_BLOCK_RE.source, "gi");
  const blockMatches = [...source.matchAll(blockPattern)];
  if (blockMatches.length) {
    const withoutBlocks = source
      .replace(new RegExp(CLARIFY_JSON_BLOCK_RE.source, "gi"), "")
      .trim();
    const fallbackQuestion = withoutBlocks.split(/\r?\n/).find(Boolean) || "";

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

  const markerIndex = findClarifyMarkerStart(source);
  if (markerIndex >= 0) {
    const visibleText = source.slice(0, markerIndex).trim();
    const markerTail = source.slice(markerIndex);
    const openMarkerMatch = markerTail.match(CLARIFY_JSON_OPEN_RE);
    const afterMarker = openMarkerMatch
      ? markerTail.slice(
          (openMarkerMatch.index || 0) + openMarkerMatch[0].length,
        )
      : markerTail;
    const markerPayloadText = afterMarker
      .replace(CLARIFY_JSON_CLOSE_RE, "")
      .trim();
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

// get clarification stream preview: extract visible text before clarification markers (hide loading animation)
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

// escape html text: prevent XSS by escaping <, >, &
function escapeHtmlText(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// encode code payload: base64 encode code for data attribute (copy button)
function encodeCodePayload(value = "") {
  try {
    return btoa(unescape(encodeURIComponent(String(value || ""))));
  } catch {
    return "";
  }
}

// decode code payload: base64 decode extracted code
function decodeCodePayload(value = "") {
  try {
    return decodeURIComponent(escape(atob(String(value || ""))));
  } catch {
    return "";
  }
}

// render code block html: build <pre><code> with language badge + copy button
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

// regex to match markdown code fence opening lines (```) with optional language tag
const CODE_FENCE_LINE_RE = /^```([a-zA-Z0-9_+.-]*)\s*$/;

// normalize markdown code fences: fix streaming artifacts (duplicate/mismatched language tags)
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
      // Common streaming artifact: continuation re-opens the same fence.
      continue;
    }

    out.push(line);
  }

  if (inFence) {
    out.push("```");
  }

  return out.join("\n");
}

// render markdown: convert markdown syntax to HTML (bold, italic, lists, links, code blocks)
function renderMarkdown(raw = "") {
  // markdown erst normalisieren damit stream reste keinen html müll bauen
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
    .replace(/\*\*(.*?)\*\*/gs, "<strong>$1</strong>")
    .replace(/__(.*?)__/gs, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gs, "<em>$1</em>")
    .replace(/_(.*?)_/gs, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[(.*?)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/^\s*[-*•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br />");

  html = html.replace(/((?:<li>.*?<\/li>(?:<br \/>)?)+)/g, "<ul>$1</ul>");
  html = html.replace(
    /<ul>(.*?)<\/ul>/gs,
    (_full, inner) => `<ul>${String(inner || "").replace(/<br \/>/g, "")}</ul>`,
  );

  return html;
}

/* strip img: remove markdown image syntax from text (clean for clipboard) */
const stripImg = (text = "") =>
  extractClarificationPayload(
    text.replace(/!\[.*?\]\([^)]+\)\n\n?/g, "").trim(),
  ).cleanedText;

/* to context content: preserve only server-managed images, collapse excessive whitespace for LLM context window */
const toContextContent = (text = "") =>
  String(text || "")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (full, rawUrl) => {
      const url = String(rawUrl || "").trim();
      return /\/history\/images\//.test(url) ? full : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* extract image url: parse markdown image syntax to get first image URL (for preview) */
function extractImageUrl(content = "") {
  const m = content.match(/!\[.*?\]\(([^)]+)\)/);
  return m ? m[1] : null;
}

/* push url: sync browser address bar with current page route */
function pushUrl(url) {
  if (window.location.pathname !== url) window.history.pushState(null, "", url);
}

// uid: generate unique ID for messages (timestamp + random suffix)
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// svg icon: image frame (used for image upload button)
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

// chat interface: main component - handles all chat UI/UX: message input, streaming responses, clarification popups
// includes: model/style selection, image upload, internet toggle, sidebar, auth, message editing, toast notifications
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
  const isWelcomeState = messages.length === 0;

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    setSelectedModel(getPlanModel(user?.plan));
  }, [user?.plan]);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
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
      const immediate =
        options?.immediate === true ||
        options?.liveUpdate === true ||
        CLARIFY_POPUP_DELAY_MS <= 0;
      clearQueuedClarifyPopup();

      if (immediate) {
        setClarifyPopup((prev) => {
          const nextSignature = getClarifyPayloadSignature(payload);
          const prevSignature = getClarifyPayloadSignature(prev);
          if (nextSignature && nextSignature === prevSignature) return prev;
          return payload;
        });
        return;
      }

      clarifyPopupTimeoutRef.current = setTimeout(
        () => {
          setClarifyPopup((prev) => {
            const nextSignature = getClarifyPayloadSignature(payload);
            const prevSignature = getClarifyPayloadSignature(prev);
            if (nextSignature && nextSignature === prevSignature) return prev;
            return payload;
          });
          clarifyPopupTimeoutRef.current = null;
        },
        immediate ? 0 : CLARIFY_POPUP_DELAY_MS,
      );
    },
    [clearQueuedClarifyPopup],
  );

  const showToast = useCallback((message, type = "success") => {
    if (!message) return;
    setToast({ message, type, id: Date.now() });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      clearQueuedClarifyPopup();
    };
  }, [clearQueuedClarifyPopup]);

  const welcomeMessage = useMemo(() => {
    const toMessageArray = (value) => {
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry || "").trim()).filter(Boolean);
      }

      if (value && typeof value === "object") {
        return Object.values(value)
          .map((entry) => String(entry || "").trim())
          .filter(Boolean);
      }

      const text = String(value || "").trim();
      if (!text || text.startsWith("chat.")) return [];
      return [text];
    };

    const displayName = String(
      user?.username || t("chat.nameFallback", { defaultValue: "there" }),
    ).trim();

    const guestMessages = toMessageArray(
      t("chat.welcomeGuest", { returnObjects: true }),
    );
    const legacyMessages = toMessageArray(
      t("chat.welcome", { returnObjects: true }),
    );
    const basePool = guestMessages.length > 0 ? guestMessages : legacyMessages;

    const loggedInMessages = user
      ? toMessageArray(
          t("chat.welcomeLoggedIn", {
            returnObjects: true,
            name: displayName,
          }),
        )
      : [];

    const pool =
      user && loggedInMessages.length > 0
        ? [...basePool, ...loggedInMessages]
        : basePool;

    if (pool.length === 0) return "";
    return pool[Math.floor(Math.random() * pool.length)];
  }, [i18n.language, t, user?.username, user]);

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
    // handler separat halten, sonst wird die render-logik schnell wirr
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
    // handler separat halten, sonst wird die render-logik schnell wirr
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

  // Upload image file to server and return URL for insertion into messages
  const uploadImage = useCallback(
    async (file) => {
      // Prepare multipart form with image file
      const fd = new FormData();
      fd.append("image", file);
      // POST to server with authorization
      const res = await authFetch("/api/history/upload-image", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
      // Return URL path from server response
      return (await res.json()).url;
    },
    [authFetch],
  );

  // Warm up model by sending preload request to prevent cold start latency
  const preloadModel = useCallback(
    async (modelId) => {
      if (!user || !modelId) return;

      // Check if model was warm enough recently (avoid spamming server)
      const now = Date.now();
      const warmUntil = modelWarmUntilRef.current[modelId] || 0;
      if (warmUntil > now) return;

      try {
        // Send preload signal with 5min cooldown to avoid duplicate requests
        const res = await authFetch("/api/chat/preload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId }),
        });

        if (res.ok) {
          // Mark model as warm for next 5 minutes
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

  // Load previously saved chat from server by filename
  const loadChat = useCallback(
    async (filename) => {
      try {
        // Fetch chat data from history API
        const res = await authFetch(`/api/history/${filename}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Transform server format (role/content) to local format (isUser/content)
        const loaded = (data.messages ?? []).map((m, i) => ({
          content: m.content,
          isUser: m.role === "user",
          id: `loaded-${i}-${uid()}`,
        }));
        setMessages(loaded);
        setCurrentChatId(filename);
        // Update URL to reflect loaded chat UUID
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

  // Persist chat to server history with optional title generation
  const saveChat = useCallback(
    async (msgs, chatIdToUse, generateTitle = false) => {
      if (!msgs.length) return;
      try {
        // POST chat messages to server (generateTitle triggers auto-title on first save)
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
        // If new chat, save returned filename and update URL with UUID
        if (saved.filename && !chatIdToUse) {
          setCurrentChatId(saved.filename);
          currentChatRef.current = saved.filename;
          const uuid = saved.filename.match(/chat_([a-f0-9-]+)\.json/)?.[1];
          if (uuid) pushUrl(localPath(`/chat/${uuid}`));
        }
        // Notify sidebar to refresh chat history list
        window.dispatchEvent(new CustomEvent("chatHistoryUpdated"));
      } catch (err) {
        console.error("Failed to save chat:", err);
      }
    },
    [authFetch],
  );

  // Handle image file selection from input or drag-drop, validate and preview
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validate file is an image type
    if (!file.type.startsWith("image/")) {
      alert(t("chat.errors.notImage", { name: file.name }));
      return;
    }
    // Reject oversized images (check against MAX_IMAGE_MB limit)
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      alert(t("chat.errors.tooLarge", { max: MAX_IMAGE_MB }));
      return;
    }
    // Store file for upload and generate data URL preview
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) =>
      setImagePreview({ dataUrl: ev.target.result, name: file.name });
    reader.readAsDataURL(file);
    // Close plus menu and reset input for reselection
    setShowPlusMenu(false);
    e.target.value = "";
  };

  const clearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const sendMessage = useCallback(async () => {
    // normalize input: trim whitespace, fallback to generic "describe image" if only image attached
    const text = input.trim() || (imageFile ? t("chat.describeImage") : "");
    // guard: abort if empty or already processing previous message
    if (!text || isSending) return;

    // check if this message is a reply to the clarification popup (user picked option or freeform)
    const clarifyReplyFromPopup = Boolean(clarifyPopup);
    // format reply as Q: question\nA: answer if it's a clarification response, otherwise use raw text
    const requestText = clarifyReplyFromPopup
      ? formatClarifyReply(clarifyPopup?.question, text)
      : text;

    // dismiss the clarification popup once reply is processed
    clearQueuedClarifyPopup();
    setClarifyPopup(null);

    // check authentication: if not logged in, store message and show login modal
    if (!user) {
      pendingInputRef.current = requestText;
      setAuthModalOpen(true);
      return;
    }

    // mark that this message is responding to clarification (used by streaming handler to avoid repeat popups)
    if (clarifyReplyFromPopup) {
      pendingClarifyReplyRef.current = true;
    }

    // set sending state (disables send button) and clear input field immediately
    setIsSending(true);
    setInput("");

    // handle image upload if user attached an image
    let imageUrl = null;
    const fileCopy = imageFile;
    if (fileCopy) {
      // clear image from UI immediately
      clearImage();
      try {
        // POST image to /api/history/upload-image and get persisted URL
        imageUrl = await uploadImage(fileCopy);
      } catch (err) {
        // if upload fails, fallback to local dataUrl (base64 embedded in message)
        console.error("Image upload failed:", err);
        imageUrl = imagePreview?.dataUrl ?? null;
      }
    }

    // combine image markdown ![...](url) + text into single user message content
    const userContext = imageUrl
      ? `![Bild](${imageUrl})\n\n${requestText}`
      : requestText;
    // create message object with unique ID and metadata
    const userMsg = { content: userContext, isUser: true, id: uid() };

    // transform all previous messages to context format: {role: 'user'|'assistant', content: cleaned text}
    // this strips markdown images and normalizes formatting for API consumption
    const contextSnap = messages.map((m) => ({
      role: m.isUser ? "user" : "assistant",
      content: toContextContent(m.content),
    }));

    // append user message to message list (update UI)
    const withUser = [...messages, userMsg];
    setMessages(withUser);

    // start streaming response: pass all required parameters to runStream
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
      // create placeholder message in UI for AI response (empty at first, fills as tokens arrive)
      const aiId = uid();
      setMessages((prev) => [
        ...prev,
        { content: "", isUser: false, id: aiId },
      ]);

      // setup abort controller for stop button (allows user to cancel mid-stream)
      const controller = new AbortController();
      abortRef.current = controller;
      let fullText = "";

      try {
        // build FormData payload for /api/chat/stream endpoint
        const fd = new FormData();
        fd.append("message", userText);
        // pass conversation context so model knows previous messages
        fd.append("context", JSON.stringify(contextSnap));
        fd.append("model", model); // which model to use (2b/4b/8b)
        fd.append("aiStyle", style); // formal/friendly/precise communication style
        fd.append("internetAccess", useInternet ? "true" : "false"); // allow web search?
        fd.append("clientSource", "web"); // track that request came from web (vs extension)

        // mark if this is a response to clarification popup (prevents repeat clarifications)
        const clarifyReply = pendingClarifyReplyRef.current;
        pendingClarifyReplyRef.current = false;
        if (clarifyReply) {
          fd.append("clarifyReply", "true");
        }

        // attach image file if user uploaded an image
        if (file) fd.append("image", file);

        // add auth token to headers if user is logged in
        const token = localStorage.getItem("wieland_token");
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        // POST to server and open streaming response
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers,
          body: fd,
          signal: controller.signal, // allows abort() to cancel fetch
        });
        if (!res.ok) throw new Error(`API ${res.status}`);

        // parse response headers for metadata about memory saving and clarification forcing
        const memorySaved = res.headers.get("X-Wieland-Memory-Saved") === "1";
        const memoryCount = Number(
          res.headers.get("X-Wieland-Memory-Count") || "0",
        );
        const clarifyForced =
          res.headers.get("X-Wieland-Clarify-Forced") === "1";

        // show toast if server extracted and saved memory items
        if (memorySaved && memoryCount > 0) {
          showToast(t("chat.memorySaved", { count: memoryCount }), "success");
        }

        // setup reader for streaming response body (tokens arrive one at a time)
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        // stream token für token lesen damit die ui sofort reagiert :)
        // read chunks as they arrive from server, decode UTF-8, append to fullText
        while (true) {
          const { done, value } = await reader.read();
          if (done) break; // stream ended
          fullText += decoder.decode(value, { stream: true });

          // extract visible text preview (hide [[WIELAND_CLARIFY_JSON]] markers from UI)
          const preview = getClarificationStreamPreview(fullText);
          const previewText = preview.text;
          // update AI message in real-time as text arrives (so user sees text appearing)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId ? { ...m, content: previewText } : m,
            ),
          );
        }

        // nach dem stream klar trennen zwischen sichtbarer antwort und popup payload
        // extract clarification popup data from response (if present) + get clean visible text
        const clarification = extractClarificationPayload(fullText);
        const clarificationPayload = clarification.payload; // parsed popup question/options or null
        const finalAssistantText =
          clarification.cleanedText || fullText || t("chat.shortError");

        // update AI message with final visible text (without clarification markers)
        if (finalAssistantText !== fullText) {
          fullText = finalAssistantText;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId ? { ...m, content: finalAssistantText } : m,
            ),
          );
        }

        // if response includes clarification popup, queue it for display
        if (clarificationPayload) {
          queueClarifyPopup(clarificationPayload, {
            immediate: clarifyForced, // force immediate display if server marked it urgent
          });
        }

        // save chat history to database (only if new chat or when content changes)
        const final = [...baseMessages];
        if (finalAssistantText) {
          final.push({ content: finalAssistantText, isUser: false, id: aiId });
        }
        const isNew = !currentChatRef.current && final.length <= 2; // new chat if no ID yet + few messages
        await saveChat(final, currentChatRef.current, isNew);
      } catch (err) {
        // handle abort (user clicked stop button mid-stream)
        if (err.name === "AbortError") {
          // save partial response if in an existing chat
          if (currentChatRef.current) {
            await saveChat(
              [...baseMessages, { content: fullText, isUser: false, id: aiId }],
              currentChatRef.current,
              false,
            );
          }
          return; // exit gracefully
        }

        // handle other errors (network, timeout, server error)
        console.error("Stream error:", err);
        const fallback = t("chat.errors.server");
        setMessages((prev) =>
          prev.map((m) => (m.id === aiId ? { ...m, content: fallback } : m)),
        );
      } finally {
        // cleanup: clear abort controller and re-enable send button
        abortRef.current = null;
        setIsSending(false);
      }
    },
    [saveChat, showToast, t, queueClarifyPopup],
  );

  // Stop ongoing token generation by aborting fetch request
  const stopGeneration = () => abortRef.current?.abort();

  // Send message on Enter key press (allow Shift+Enter for newline)
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isSending) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Start new conversation - abort pending requests, clear messages and state
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

  // Enable edit mode for last user message (only allow editing the most recent user msg)
  const startEditing = (msg) => {
    if (msg.id !== lastUserMsg?.id) return;
    setEditingId(msg.id);
    setEditingText(stripImg(msg.content));
  };

  // Discard edits and exit edit mode
  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };
  // Save edited user message and optionally regenerate AI response if one existed after it

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
      return;
    }

    if (currentChatRef.current) {
      await saveChat(truncated, currentChatRef.current, false);
    }
  };

  // Regenerate last AI response based on edited user message
  const regenerate = useCallback(async () => {
    if (isSending || !messages.length) return;
    // Find last AI message (right to left scan)
    const aiIdx = [...messages].reduceRight(
      (found, m, i) => (found === -1 && !m.isUser ? i : found),
      -1,
    );
    if (aiIdx === -1) return;
    // Find last user message before AI response
    const uIdx = messages
      .slice(0, aiIdx)
      .reduceRight((f, m, i) => (f === -1 && m.isUser ? i : f), -1);
    if (uIdx === -1) return;

    // Get user message content/image and truncate at that point
    const uMsg = messages[uIdx];
    const imgUrl = extractImageUrl(uMsg.content);
    const truncated = messages.slice(0, aiIdx);
    setMessages(truncated);
    setIsSending(true);

    // Build context from messages before user's message
    const ctx = truncated.slice(0, uIdx).map((m) => ({
      role: m.isUser ? "user" : "assistant",
      content: toContextContent(m.content),
    }));
    // Re-fetch and convert image if present in message
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
    // Restart stream with original user input
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

  // Copy message text to clipboard (strip image URLs first)
  const copyText = useCallback(
    async (content) => {
      try {
        // Write plaintext version (no image markup) to clipboard
        await navigator.clipboard.writeText(stripImg(content));
        showToast(t("chat.copied"), "success");
      } catch (err) {
        console.error(err);
        showToast(t("chat.errors.server"), "error");
      }
    },
    [showToast, t],
  );

  // Copy code block to clipboard (decode from encoded payload format)
  const copyCode = useCallback(
    async (encodedCode) => {
      // Decode code payload from custom encoding
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
        <div
          className={`messages-area ${isWelcomeState ? "welcome-mode" : ""}`}
        >
          {isWelcomeState
            ? null
            : messages.map((msg, idx) => (
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
              ))}
          <div ref={messagesEndRef} />
        </div>

        <div
          className={`chat-input-container ${imagePreview ? "has-preview" : ""} ${isWelcomeState ? "welcome-mode" : ""}`}
          style={isWelcomeState ? undefined : { bottom: `${inputOffset}px` }}
        >
          {isWelcomeState && (
            <div className="welcome-message-container">
              <span>{welcomeMessage}</span>
            </div>
          )}

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
            <ClarifyPopup data={clarifyPopup} onSelect={sendClarifyReply} />
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
              aria-label={
                clarifyPopup
                  ? getLocalizedIdeaPlaceholder(i18n.language)
                  : t("chat.options")
              }
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
                      ? clarifyPopup.freeformPlaceholder ||
                        getLocalizedIdeaPlaceholder(i18n.language)
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

      {toast && (
        <div className={`chat-toast ${toast.type}`}>{toast.message}</div>
      )}

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

// Clarification popup: character-by-character typing animation for question/options reveal
function ClarifyPopup({ data, onSelect }) {
  if (!data) return null;

  // Target text for animation (full question and options list)
  const questionTarget = String(data.question || "");
  // Parse options array into normalized label/id format
  const optionsTarget = useMemo(
    () =>
      (Array.isArray(data.options) ? data.options : []).map((option) => ({
        id: String(option?.id || "")
          .trim()
          .toUpperCase(),
        label: String(option?.label || ""),
      })),
    [data.options],
  );
  const questionTargetRef = useRef(questionTarget);
  const optionsTargetRef = useRef(optionsTarget);
  // Track typing animation progress (which chars shown, which options visible, option lengths)
  const [typingState, setTypingState] = useState({
    questionLength: 0,
    shownOptions: 0,
    optionLengths: [],
  });

  // Reset typing animation when question/options data changes
  useEffect(() => {
    questionTargetRef.current = questionTarget;
    optionsTargetRef.current = optionsTarget;

    setTypingState((prev) => {
      const nextOptionLengths = optionsTarget.map((option, index) =>
        Math.min(Number(prev.optionLengths[index] || 0), option.label.length),
      );
      const shownFromLengths = nextOptionLengths.filter(
        (len) => len > 0,
      ).length;

      return {
        questionLength: Math.min(prev.questionLength, questionTarget.length),
        shownOptions: Math.max(
          Math.min(prev.shownOptions, optionsTarget.length),
          shownFromLengths,
        ),
        optionLengths: nextOptionLengths,
      };
    });
  }, [questionTarget, optionsTarget]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTypingState((prev) => {
        const liveQuestionTarget = String(questionTargetRef.current || "");
        const liveOptionsTarget = Array.isArray(optionsTargetRef.current)
          ? optionsTargetRef.current
          : [];

        let questionLength = prev.questionLength;
        let shownOptions = prev.shownOptions;
        const optionLengths = [...prev.optionLengths];
        let changed = false;

        if (questionLength < liveQuestionTarget.length) {
          questionLength = Math.min(
            liveQuestionTarget.length,
            questionLength + CLARIFY_QUESTION_CHARS_PER_TICK,
          );
          changed = true;
        } else if (liveOptionsTarget.length > 0) {
          if (shownOptions === 0) {
            shownOptions = 1;
            if (!Number.isFinite(optionLengths[0])) optionLengths[0] = 0;
            changed = true;
          } else {
            let activeOptionIndex = -1;
            for (let i = 0; i < shownOptions; i++) {
              const targetLen = liveOptionsTarget[i]?.label?.length || 0;
              const currentLen = Number(optionLengths[i] || 0);
              if (currentLen < targetLen) {
                activeOptionIndex = i;
                break;
              }
            }

            if (activeOptionIndex >= 0) {
              const targetLen =
                liveOptionsTarget[activeOptionIndex].label.length;
              optionLengths[activeOptionIndex] = Math.min(
                targetLen,
                Number(optionLengths[activeOptionIndex] || 0) +
                  CLARIFY_OPTION_CHARS_PER_TICK,
              );
              changed = true;
            } else if (shownOptions < liveOptionsTarget.length) {
              shownOptions += 1;
              if (!Number.isFinite(optionLengths[shownOptions - 1])) {
                optionLengths[shownOptions - 1] = 0;
              }
              changed = true;
            }
          }
        }

        if (!changed) return prev;

        return {
          questionLength,
          shownOptions,
          optionLengths,
        };
      });
    }, CLARIFY_TYPE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const typedQuestion = questionTarget.slice(0, typingState.questionLength);
  const visibleOptions = optionsTarget
    .slice(0, Math.max(0, typingState.shownOptions))
    .map((option, index) => {
      const fullLabel = String(option.label || "");
      const typedLength = Math.min(
        Number(typingState.optionLengths[index] || 0),
        fullLabel.length,
      );

      return {
        ...option,
        typedLabel: fullLabel.slice(0, typedLength),
        isTyping: typedLength < fullLabel.length,
      };
    });

  const optionsStillTyping = visibleOptions.some((option) => option.isTyping);
  const moreOptionsPending = typingState.shownOptions < optionsTarget.length;
  const questionStillTyping =
    typingState.questionLength < questionTarget.length;
  const showLoading =
    optionsTarget.length === 0 || optionsStillTyping || moreOptionsPending;
  const showCursor = questionStillTyping || showLoading;
  const stepLabel =
    data.step && data.totalSteps && data.totalSteps > 1
      ? `${data.step} von ${data.totalSteps}`
      : "";

  return (
    <div className="clarify-dock" role="dialog" aria-label={data.question}>
      <div className="clarify-dock-card">
        <div className="clarify-dock-head">
          <h3>
            {typedQuestion || " "}
            {showCursor && <span className="clarify-dock-typing">|</span>}
          </h3>
        </div>

        {stepLabel && <div className="clarify-dock-step">{stepLabel}</div>}

        <div className="clarify-dock-options">
          {visibleOptions.map((option, index) => {
            const optionReply = /^[A-E]$/.test(option.id)
              ? `${option.id}) ${option.label}`
              : option.label;
            const quickReply = formatClarifyReply(data.question, optionReply);

            return (
              <button
                key={`${option.id}-${index}`}
                className="clarify-dock-option"
                disabled={!option.typedLabel}
                onClick={() => onSelect(quickReply)}
              >
                <span className="clarify-dock-option-index">{index + 1}</span>
                <span
                  className={`clarify-dock-option-label ${option.isTyping ? "typing" : ""}`}
                >
                  {option.typedLabel || " "}
                </span>
                <span className="clarify-dock-option-arrow">›</span>
              </button>
            );
          })}
          {showLoading && <div className="clarify-dock-loading">Typing...</div>}
        </div>
      </div>
    </div>
  );
}

// Render individual chat message: user text/images or AI response with edit/copy actions
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
  // Extract image URL from message markdown (format: ![Bild](url))
  const imageUrl = extractImageUrl(msg.content);
  // Plaintext version without image markup (for display/copy functionality)
  const textOnly = stripImg(msg.content);

  // Intercept code copy button clicks via event delegation (avoid per-button listeners)
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
