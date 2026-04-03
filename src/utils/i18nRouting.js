export const SUPPORTED_LANGS = ["de", "en", "it"];
export const DEFAULT_LANG = "de";
const STORAGE_KEY = "wieland_lang";
const CONSENT_KEY = "wieland_cookie_consent";

// is supported lang: check if lang code is in supported list (de/en/it)
export function isSupportedLang(lang) {
  return SUPPORTED_LANGS.includes((lang || "").toLowerCase());
}

// extract lang from path: get language from first path segment (e.g. /de/chat -> "de")
export function extractLangFromPath(pathname = "/") {
  const first = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return isSupportedLang(first) ? first : null;
}

// strip lang prefix: remove language segment from beginning of path
export function stripLangPrefix(pathname = "/") {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  if (isSupportedLang(segments[0])) {
    const rest = segments.slice(1).join("/");
    return rest ? `/${rest}` : "/";
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

// with lang: prepend language prefix to path (e.g. /chat + de -> /de/chat)
export function withLang(path = "/", lang = DEFAULT_LANG) {
  const safeLang = isSupportedLang(lang) ? lang : DEFAULT_LANG;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `/${safeLang}/`;
  return `/${safeLang}${normalized}`;
}

// get stored lang: retrieve user's language preference from localStorage or cookies
export function getStoredLang() {
  try {
    const local = localStorage.getItem(STORAGE_KEY);
    if (isSupportedLang(local)) return local;
  } catch {}

  try {
    const cookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${STORAGE_KEY}=`));
    const value = cookie?.split("=")[1];
    if (isSupportedLang(value)) return value;
  } catch {}

  return null;
}

// get preferred lang: resolve language from path, stored preference, or default
export function getPreferredLang(pathname = "/") {
  const fromPath = extractLangFromPath(pathname);
  if (fromPath) return fromPath;
  return getStoredLang() || DEFAULT_LANG;
}

// persist lang: save user's language preference to localStorage + cookies (if consent)
export function persistLang(lang) {
  if (!isSupportedLang(lang)) return;

  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}

  try {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === "accepted") {
      document.cookie = `${STORAGE_KEY}=${lang}; path=/; max-age=31536000`;
    }
  } catch {}
}
