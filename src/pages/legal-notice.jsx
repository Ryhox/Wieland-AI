import "../styles/LegalPage.css";
import "../styles/main.css";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";

// Zentrale Page für Impressum - Simple Static Content mit i18n
function LegalNotice({ isSidebarOpen, onSidebarToggle }) {
  // Translations laden
  const { t } = useTranslation();
  const { user } = useAuth();
  // Sections aus i18n als Array um über zu loopen
  const sections = t("legal.noticeSections", { returnObjects: true }) || [];

  return (
    <div
      className={`page-wrapper content-page ${isSidebarOpen ? "sidebar-open" : ""}`}
    >
      {/* Header mit Toggle Button */}
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {/* Sidebar nur wenn User da ist */}
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}
      <main className="page-content">
        <div className="page-container legal-container">
          {/* Hero Section - Eyebrow + Title + Lead */}
          <div className="legal-hero">
            <span className="legal-eyebrow">{t("legal.noticeEyebrow")}</span>
            <h1 className="legal-h1">
              <span>{t("legal.noticeTitle")}</span>
            </h1>
            <p className="legal-lead">{t("legal.noticeLead")}</p>
          </div>

          {/* Content Card mit allen Sections */}
          <div className="legal-card">
            {/* Loop über alle Sections - Title + Paragraphs + Lists */}
            {sections.map((section) => (
              <div className="legal-section" key={section.title}>
                <div className="legal-section-h">{section.title}</div>
                <div className="legal-section-divider" />
                {/* Paragraphs rendern wenn vorhanden */}
                {Array.isArray(section.paragraphs) &&
                  section.paragraphs.map((paragraph, idx) => (
                    <p className="legal-p" key={`${section.title}-p-${idx}`}>
                      {paragraph}
                    </p>
                  ))}
                {/* Lists rendern wenn vorhanden */}
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
        </div>
      </main>
      <Footer /> {/* Footer am unteren Rand */}
    </div>
  );
}

export default LegalNotice;
