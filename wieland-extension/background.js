chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const WEBSITE_LANG_KEY = "wieland_lang";
const SUPPORTED_LANGS = new Set(["de", "en", "it"]);

function normalizeLang(raw) {
  const value = String(raw || "")
    .toLowerCase()
    .split("-")[0]
    .trim();
  return SUPPORTED_LANGS.has(value) ? value : null;
}

function isLocalhostCookie(cookie) {
  const domain = String(cookie?.domain || "")
    .replace(/^\./, "")
    .toLowerCase();
  return domain === "localhost" || domain === "127.0.0.1";
}

if (chrome.cookies?.onChanged) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    const cookie = changeInfo?.cookie;
    if (
      !cookie ||
      cookie.name !== WEBSITE_LANG_KEY ||
      !isLocalhostCookie(cookie)
    )
      return;
    if (changeInfo.removed) return;

    const lang = normalizeLang(cookie.value);
    if (!lang) return;

    chrome.storage.local.set({ [WEBSITE_LANG_KEY]: lang }, () => {
      void chrome.runtime.lastError;
    });
  });
}
