import '../styles/LegalPage.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

function PrivacyPolicy({ isSidebarOpen, onSidebarToggle }) {
  const { user } = useAuth();
  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content">
        <div className="page-container legal-container">

          <div className="legal-hero">
            <span className="legal-eyebrow">Datenschutz</span>
            <h1 className="legal-h1"><span>Datenschutz&shy;erklärung</span></h1>
            <p className="legal-lead">
              Wir nehmen den Schutz deiner Daten ernst. Hier erfährst du, wie wir damit umgehen.
            </p>
          </div>

          <div className="legal-card">

            <div className="legal-section">
              <div className="legal-section-h">1. Datenschutz auf einen Blick</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Wieland AI ist eine lokal betriebene Anwendung. Standardmäßig verlassen keine
                Nutzerdaten das Gerät. Diese Datenschutzerklärung beschreibt, welche Daten erhoben
                werden, wenn du unsere Website besuchst oder den optionalen Online-Dienst nutzt.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">2. Erhobene Daten</div>
              <div className="legal-section-divider" />
              <ul className="legal-ul">
                <li>Lokale Anwendung: Chats und Nutzerkonten werden ausschließlich in deiner lokalen PostgreSQL-Datenbank gespeichert.</li>
                <li>Website: Standard-Webserver-Logs (IP, Zeitstempel, angefragte URL). Keine Tracking-Cookies.</li>
              </ul>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">3. Cookies</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Diese Website verwendet keine Marketing- oder Tracking-Cookies.
                Session-Cookies werden ausschließlich für technische Funktionen eingesetzt.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">4. Datenweitergabe</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Deine Daten werden nicht an Dritte verkauft oder zu Werbezwecken weitergegeben.
                Eine Übermittlung erfolgt nur, wenn du den Online-Fallback explizit aktiviert hast.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">5. Deine Rechte</div>
              <div className="legal-section-divider" />
              <ul className="legal-ul">
                <li>Auskunft über gespeicherte Daten (Art. 15 DSGVO)</li>
                <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
                <li>Löschung deiner Daten (Art. 17 DSGVO)</li>
                <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)</li>
              </ul>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">6. Kontakt</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Bei Fragen zum Datenschutz: <a href="mailto:kontakt@wieland.ai">kontakt@wieland.ai</a>
              </p>
            </div>

          </div>

          <p className="legal-footer-note">Stand: März 2025</p>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default PrivacyPolicy;