import "../styles/Footer.css";
import { useTranslation } from "react-i18next";
import { withLang } from "../utils/i18nRouting";

// Footer: static links (contact, legal, privacy, terms) för all pages
function Footer() {
  const { t, i18n } = useTranslation();
  // localized paths: inject current language in URL
  const localPath = (path) => withLang(path, i18n.language);

  return (
    <footer className="footer">
      <div className="footer-container">
        <span className="footer-logo">Wieland AI</span>
        <div className="footer-links">
          <a href={localPath("/contact")}>{t("footer.contact")}</a>
          <a href={localPath("/legal-notice")}>{t("footer.legalNotice")}</a>
          <a href={localPath("/privacy-policy")}>{t("footer.privacy")}</a>
          <a href={localPath("/terms-of-service")}>{t("footer.terms")}</a>
        </div>
        <span className="footer-copy">
          {t("footer.copyright", { year: new Date().getFullYear() })}
        </span>
      </div>
    </footer>
  );
}

export default Footer;
