// Extension öffnen wenn Icon geklickt wird
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
// Automatisch öffnen statt nur beim Click bereit zu halten
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const WEBSITE_LANG_KEY = "wieland_lang";
const SUPPORTED_LANGS = new Set(["de", "en", "it"]);

// Sprache auf Haupt-Code normalisieren (de/en/it)
function normalizeLang(raw) {
  const value = String(raw || "")
    .toLowerCase()
    .split("-")[0] // Ländercode rausfiltern (de-AT > de)
    .trim();
  return SUPPORTED_LANGS.has(value) ? value : null;
}

// Nur localhost Cookies relevant für uns
function isLocalhostCookie(cookie) {
  const domain = String(cookie?.domain || "")
    .replace(/^\./, "") // Leading dot weg
    .toLowerCase();
  return domain === "localhost" || domain === "127.0.0.1";
}

// Wenn Website Sprach-Cookie ändert > Sync zu Storage damit App-panel es sieht
if (chrome.cookies?.onChanged) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    const cookie = changeInfo?.cookie;
    // Irrelevante Cookies skippen
    if (
      !cookie ||
      cookie.name !== WEBSITE_LANG_KEY ||
      !isLocalhostCookie(cookie)
    )
      return;
    if (changeInfo.removed) return;

    const lang = normalizeLang(cookie.value);
    if (!lang) return;

    // Ins Local Storage (für App-panel zugreifbar)
    chrome.storage.local.set({ [WEBSITE_LANG_KEY]: lang }, () => {
      void chrome.runtime.lastError; // Ignorieren, ist nur background
    });
  });
}
