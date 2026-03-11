import '../styles/LegalPage.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

function LegalNotice({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header noSidebar />

      <main className="page-content">
        <div className="page-container legal-container">

          <div className="legal-hero">
            <span className="legal-eyebrow">Rechtliches</span>
            <h1 className="legal-h1"><span>Impressum</span></h1>
            <p className="legal-lead">
              Angaben gemäß Art. 7 des italienischen Gesetzesdekrets Nr. 70/2003.
            </p>
          </div>

          <div className="legal-card">

            <div className="legal-section">
              <div className="legal-section-h">Anbieter</div>
              <div className="legal-section-divider" />
              <p className="legal-p">Wieland AI Project</p>
              <p className="legal-p">
                c/o Wieland AI<br />
                Wielandstraße 11<br />
                39042 Brixen (BZ)<br />
                Italien
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">Kontakt</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                E-Mail: <a href="mailto:kontakt@wieland.ai">kontakt@wieland.ai</a>
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">Verantwortlich für den Inhalt</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Wieland<br />
                Wielandstraße 11<br />
                39042 Brixen (BZ)<br />
                Italien </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">Haftungsausschluss</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt.
                Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte
                können wir jedoch keine Gewähr übernehmen.
                Als Diensteanbieter sind wir gemäß den geltenden italienischen
                Rechtsvorschriften, insbesondere dem Gesetzesdekret Nr. 70/2003,
                für eigene Inhalte auf diesen Seiten verantwortlich.
              </p>
            </div>

            <div className="legal-section">
              <div className="legal-section-h">Online-Streitbeilegung</div>
              <div className="legal-section-divider" />
              <p className="legal-p">
                Die Europäische Kommission stellt eine Plattform zur
                Online-Streitbeilegung (OS) bereit:
                https://ec.europa.eu/consumers/odr/
                <br /><br />
                Wir sind nicht verpflichtet und nicht bereit,
                an Streitbeilegungsverfahren vor einer
                Verbraucherschlichtungsstelle teilzunehmen.
              </p>
            </div>

          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default LegalNotice;