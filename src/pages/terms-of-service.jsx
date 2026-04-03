import "../styles/LegalPage.css";
import "../styles/main.css";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";

// AGB Page - Static Content mit dynamischen Sections aus i18n
function TermsOfService({ isSidebarOpen, onSidebarToggle }) {
  // Translation hook laden
  const { t } = useTranslation();
  // User Context um zu checken ob eingeloggt
  const { user } = useAuth();
  // Alle AGB Sections aus i18n
  const sections = t("legal.termsSections", { returnObjects: true }) || [];

  return (
    <div
      className={`page-wrapper content-page ${isSidebarOpen ? "sidebar-open" : ""}`}
    >
      {/* Header mit Menu Toggle */}
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {/* Sidebar nur wenn User vorhanden */}
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}
      <main className="page-content">
        <div className="page-container legal-container">
          {/* Top Section: Header Bereich */}
          <div className="legal-hero">
            <span className="legal-eyebrow">{t("legal.termsEyebrow")}</span>
            <h1 className="legal-h1">{t("legal.termsTitle")}</h1>
            <p className="legal-lead">{t("legal.termsLead")}</p>
          </div>

          {/* Main Content Card mit allen Sections */}
          <div className="legal-card">
            {/* Iteriert über alle Terms Sections */}
            {sections.map((section) => (
              <div className="legal-section" key={section.title}>
                <div className="legal-section-h">{section.title}</div>
                <div className="legal-section-divider" />
                {/* Text Blöcke */}
                {Array.isArray(section.paragraphs) &&
                  section.paragraphs.map((paragraph, idx) => (
                    <p className="legal-p" key={`${section.title}-p-${idx}`}>
                      {paragraph}
                    </p>
                  ))}
                {/* Bullet Points wenn in Section definiert */}
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

          {/* Footer Note: Wann wurde das letzte mal updated */}
          <p className="legal-footer-note">{t("legal.lastUpdated")}</p>
        </div>
      </main>
      <Footer /> {/* Footer Navigation */}
    </div>
  );
}

export default TermsOfService;
