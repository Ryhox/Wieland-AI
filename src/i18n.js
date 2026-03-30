import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import it from "./locales/it.json";
import { DEFAULT_LANG, getPreferredLang, persistLang } from "./utils/i18nRouting";

const resources = {
  de: { translation: de },
  en: { translation: en },
  it: { translation: it },
};

i18n.use(initReactI18next).init({
  resources,
  lng: getPreferredLang(window.location.pathname),
  fallbackLng: DEFAULT_LANG,
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

i18n.on("languageChanged", (lang) => {
  persistLang(lang);
});

export default i18n;
