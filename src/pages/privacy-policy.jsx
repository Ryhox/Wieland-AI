import "../styles/LegalPage.css";
import "../styles/main.css";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";

// Datenschutz Page - Statisches Content Layout mit i18n Sections
function PrivacyPolicy({ isSidebarOpen, onSidebarToggle }) {
  // i18n für alle Sprachen
  const { t } = useTranslation();
  const { user } = useAuth();
  // Privacy Sections aus Locale laden
  const sections = t("legal.privacySections", { returnObjects: true }) || [];

  return (
    <div
      className={`page-wrapper content-page ${isSidebarOpen ? "sidebar-open" : ""}`}
    >
      {/* Header + Navigation */}
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {/* Sidebar nur wenn auth */}
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}

      <main className="page-content">
        <div className="page-container legal-container">
          {/* Hero - Eyebrow, Title, Lead */}
          <div className="legal-hero">
            <span className="legal-eyebrow">{t("legal.privacyEyebrow")}</span>
            <h1 className="legal-h1">
              <span>{t("legal.privacyTitle")}</span>
            </h1>
            <p className="legal-lead">{t("legal.privacyLead")}</p>
          </div>

          {/* Alle Sections rendern */}
          <div className="legal-card">
            {sections.map((section) => (
              <div className="legal-section" key={section.title}>
                <div className="legal-section-h">{section.title}</div>
                <div className="legal-section-divider" />
                {/* Text Paragraphen */}
                {Array.isArray(section.paragraphs) &&
                  section.paragraphs.map((paragraph, idx) => (
                    <p className="legal-p" key={`${section.title}-p-${idx}`}>
                      {paragraph}
                    </p>
                  ))}
                {/* Bullet Lists falls vorhanden */}
                {Array.isArray(section.list) && (
                  <ul className="legal-ul">
                    {section.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <p className="legal-footer-note">{t("legal.status")}</p>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default PrivacyPolicy;
