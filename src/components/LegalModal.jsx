import { useState } from "react";
import { useTranslation } from "react-i18next";
import { withLang } from "../utils/i18nRouting";
import "../styles/LegalModal.css";

// Legal Modal: Links zu Impressum, Datenschutz, Nutzungsbedingungen
export default function LegalModal({ isOpen, onClose }) {
  const { t, i18n } = useTranslation();
  const localPath = (path) => withLang(path, i18n.language);

  if (!isOpen) return null;

  return (
    <div className="legal-modal-backdrop" onClick={onClose}>
      <div
        className="legal-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="legal-modal-header">
          <h2 className="legal-modal-title">{t("legal.noticeEyebrow")}</h2>
          <button
            className="legal-modal-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        
        <div className="legal-modal-body">
          <nav className="legal-modal-links">
            <a 
              href={localPath("/legal-notice")} 
              className="legal-modal-link"
              onClick={onClose}
            >
              {t("legal.noticeTitle")}
            </a>
            <a 
              href={localPath("/privacy-policy")} 
              className="legal-modal-link"
              onClick={onClose}
            >
              {t("legal.privacyTitle")}
            </a>
            <a 
              href={localPath("/terms-of-service")} 
              className="legal-modal-link"
              onClick={onClose}
            >
              {t("legal.termsTitle")}
            </a>
          </nav>
        </div>

        <div className="legal-modal-footer">
          <p className="legal-modal-copyright">
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </div>
  );
}
