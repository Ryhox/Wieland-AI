import '../styles/LegalPage.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

function TermsOfService({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header noSidebar />

      <main className="page-content">
        <div className="page-container legal-container">

          <div className="legal-hero">
            <span className="legal-eyebrow">Nutzungsbedingungen</span>
            <h1 className="legal-h1">Terms of<br /><span>Service</span></h1>
            <p className="legal-lead">
              Bitte lies diese Bedingungen sorgfältig, bevor du Wieland AI verwendest.
            </p>
          </div>

          <div className="legal-card">

            <div className="legal-section">
              <div className="legal-section-h">1. Geltungsbereich</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Diese Nutzungsbedingungen gelten für die Nutzung der Wieland AI Software
                sowie der zugehörigen Website. Mit der Installation oder Nutzung
                stimmst du diesen Bedingungen zu.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">2. Nutzungsrechte</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Wieland AI wird unter der MIT-Lizenz bereitgestellt. Du darfst die
                Software frei nutzen, kopieren, modifizieren und weitergeben,
                solange der Lizenzhinweis erhalten bleibt.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">3. Verbotene Nutzung</div>
              <div className="legal-section-divider" />
              <ul className="legal-ul">
                <li>Einsatz für illegale Zwecke oder zur Verletzung von Rechten Dritter</li>
                <li>Automatisierter Missbrauch von Online-Diensten</li>
                <li>Manipulation oder Umgehung von Sicherheitsmechanismen</li>
                <li>Weitergabe von Admin-Zugangsdaten an unbefugte Personen</li>
              </ul>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">4. Haftungsbeschränkung</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Wieland AI wird „wie besehen“ bereitgestellt, ohne ausdrückliche
                oder stillschweigende Garantien. Der Anbieter haftet nicht für
                Schäden, die aus der Nutzung der Software entstehen, soweit dies
                nach geltendem Recht zulässig ist.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">5. KI-generierte Inhalte</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Inhalte und Antworten werden durch KI-Modelle generiert und
                können ungenau oder fehlerhaft sein. Sie stellen keine
                professionelle Beratung dar. Der Nutzer ist selbst für die
                Überprüfung und Verwendung der generierten Inhalte verantwortlich.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">6. Änderungen der Bedingungen</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Wir behalten uns vor, diese Nutzungsbedingungen jederzeit zu
                ändern. Wesentliche Änderungen werden auf der Website oder im
                Changelog veröffentlicht.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">7. Anwendbares Recht</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Es gilt das Recht der Italienischen Republik. Gerichtsstand ist,
                soweit gesetzlich zulässig, der Sitz des Anbieters.
              </p>
            </div>

          </div>

          <p className="legal-footer-note">Zuletzt aktualisiert: März 2026</p>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default TermsOfService;