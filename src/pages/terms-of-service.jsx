import '../styles/LegalPage.css';
import '../styles/main.css';
import { useTranslation } from 'react-i18next';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

function TermsOfService({ isSidebarOpen, onSidebarToggle }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const sections = t('legal.termsSections', { returnObjects: true }) || [];

  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content">
        <div className="page-container legal-container">

          <div className="legal-hero">
            <span className="legal-eyebrow">{t('legal.termsEyebrow')}</span>
            <h1 className="legal-h1">{t('legal.termsTitle')}</h1>
            <p className="legal-lead">
              {t('legal.termsLead')}
            </p>
          </div>

          <div className="legal-card">

            {sections.map((section) => (
              <div className="legal-section" key={section.title}>
                <div className="legal-section-h">{section.title}</div>
                <div className="legal-section-divider" />
                {Array.isArray(section.paragraphs) && section.paragraphs.map((paragraph, idx) => (
                  <p className="legal-p" key={`${section.title}-p-${idx}`}>{paragraph}</p>
                ))}
                {Array.isArray(section.list) && (
                  <ul className="legal-ul">
                    {section.list.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </div>
            ))}

          </div>

          <p className="legal-footer-note">{t('legal.lastUpdated')}</p>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default TermsOfService;
