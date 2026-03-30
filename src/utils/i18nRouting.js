export const SUPPORTED_LANGS = ["de", "en", "it"];
export const DEFAULT_LANG = "de";
const STORAGE_KEY = "wieland_lang";
const CONSENT_KEY = "wieland_cookie_consent";

export function isSupportedLang(lang) {
  return SUPPORTED_LANGS.includes((lang || "").toLowerCase());
}

export function extractLangFromPath(pathname = "/") {
  const first = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return isSupportedLang(first) ? first : null;
}

export function stripLangPrefix(pathname = "/") {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  if (isSupportedLang(segments[0])) {
    const rest = segments.slice(1).join("/");
    return rest ? `/${rest}` : "/";
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function withLang(path = "/", lang = DEFAULT_LANG) {
  const safeLang = isSupportedLang(lang) ? lang : DEFAULT_LANG;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `/${safeLang}/`;
  return `/${safeLang}${normalized}`;
}

export function getStoredLang() {
  try {
    const local = localStorage.getItem(STORAGE_KEY);
    if (isSupportedLang(local)) return local;
  } catch {
    // ignore storage read errors
  }

  try {
    const cookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${STORAGE_KEY}=`));
    const value = cookie?.split("=")[1];
    if (isSupportedLang(value)) return value;
  } catch {
    // ignore cookie read errors
  }

  return null;
}

export function getPreferredLang(pathname = "/") {
  const fromPath = extractLangFromPath(pathname);
  if (fromPath) return fromPath;
  return getStoredLang() || DEFAULT_LANG;
}

export function persistLang(lang) {
  if (!isSupportedLang(lang)) return;

  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore storage write errors
  }

  try {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === "accepted") {
      document.cookie = `${STORAGE_KEY}=${lang}; path=/; max-age=31536000`;
    }
  } catch {
    // ignore cookie write errors
  }
}
