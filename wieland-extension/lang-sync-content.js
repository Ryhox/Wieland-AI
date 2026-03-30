(() => {
  const KEY = 'wieland_lang';
  const SUPPORTED = new Set(['de', 'en', 'it']);
  let lastLang = null;
  let timer = null;

  function normalizeLang(raw) {
    const value = String(raw || '').toLowerCase().split('-')[0].trim();
    return SUPPORTED.has(value) ? value : null;
  }

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  function detectLang() {
    const fromPath = normalizeLang(location.pathname.match(/^\/(de|en|it)(\/|$)/i)?.[1]);
    if (fromPath) return fromPath;

    const fromStorage = normalizeLang(localStorage.getItem(KEY));
    if (fromStorage) return fromStorage;

    const fromHtml = normalizeLang(document.documentElement?.lang);
    if (fromHtml) return fromHtml;

    const fromCookie = normalizeLang(readCookie(KEY));
    if (fromCookie) return fromCookie;

    const fromI18nextStorage = normalizeLang(localStorage.getItem('i18nextLng'));
    if (fromI18nextStorage) return fromI18nextStorage;

    const fromI18nextCookie = normalizeLang(readCookie('i18next'));
    if (fromI18nextCookie) return fromI18nextCookie;

    return null;
  }

  function persistDetectedLang() {
    const lang = detectLang();
    if (!lang || lang === lastLang) return;

    lastLang = lang;
    chrome.storage.local.set({ [KEY]: lang }, () => {
      void chrome.runtime.lastError;
    });
  }

  function safeSync() {
    try {
      persistDetectedLang();
    } catch {
      // Intentionally ignore page-level access errors.
    }
  }

  function wrapHistoryMethod(name) {
    const original = history[name];
    if (typeof original !== 'function') return;

    history[name] = function wrappedHistoryMethod(...args) {
      const result = original.apply(this, args);
      safeSync();
      return result;
    };
  }

  safeSync();
  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');

  window.addEventListener('popstate', safeSync);
  window.addEventListener('hashchange', safeSync);
  window.addEventListener('pageshow', safeSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') safeSync();
  });

  const langObserver = new MutationObserver(safeSync);
  if (document.documentElement) {
    langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  timer = window.setInterval(safeSync, 1200);
  window.addEventListener('beforeunload', () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    langObserver.disconnect();
  }, { once: true });
})();
