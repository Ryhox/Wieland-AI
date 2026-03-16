import '../styles/Changelogs.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

const entries = [
  {
    version: 'v0.1.4',
    date: '16 März 2026',
    tag: 'green',
    title: 'Content v2.0',
    changes: [
      'Bugfixes',
      'Design überarbeitet auf allen Seiten',
      '2 Neue Pages: Profile, Kontakt',
      'Features: Abonnementssystem, Cookies, Email und Passwort bearbeiten, Chat-Search',
      'Chat links können direkt aufgerufen werden (jetzt UUID statt Timestamp)',
    ],
  },
  {
    version: 'v0.1.4',
    date: '10 März 2026',
    tag: 'pink',
    title: 'Content',
    changes: [
      '8 Neue Pages: About, Changelogs, Download, FAQ, Legal Notice, Privacy Policy, Terms of Service, Pricing',
      'Language Button im Header',
      'Bugfixes',

    ],
  },
  {
    version: 'v0.1.3',
    date: '10 März 2026',
    tag: 'purple',
    title: 'Admin-Dashboard',
    changes: [
      'Neues /dashboard mit Recharts-Visualisierungen',
      'Nutzer- und Modellverwaltung für Admins',
      'Bugfixes',
    ],
  },
  {
    version: 'v0.1.2',
    date: '06 März 2026',
    tag: 'green',
    title: 'Backend',
    changes: [
      'Backend mit ProstgreSQL',
      'Login und Registrierung',
      'Bugfixes',
    ],
  },
  {
    version: 'v0.1.1',
    date: '03 März 2026',
    tag: 'pink',
    title: 'Ki verfeinert',
    changes: [
      'Bugfixes',
      'Ki kann nun Bilder verarbeiten.',
      'Design Header und Sidebar',
    ],
  },
  {
    version: 'v0.1.0',
    date: '01 März 2026',
    tag: 'gray',
    title: 'Pre-Release',
    changes: [
      'Start des Projects',
      'Design und Entwicklung der Kernfunktionen',
      'Ollama Integration für lokale KI-Verarbeitung',
      'Design und Integration von 3D characteren',
    ],
  },
];

function Changelogs({ isSidebarOpen, onSidebarToggle }) {
  const { user } = useAuth();
  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content">
        <div className="page-container cl-container">

          <div className="cl-hero">
            <span className="cl-eyebrow">Changelogs</span>
            <h1 className="cl-h1">Was ist<br /><span>neu?</span></h1>
            <p className="cl-lead">Alle Versionen, Fixes und Features — chronologisch dokumentiert.</p>
          </div>

          <div className="cl-timeline">
            {entries.map((entry, i) => (
              <div className="cl-entry" key={i}>

                <div className="cl-side">
                  <span className="cl-version">{entry.version}</span>
                  <span className="cl-date">{entry.date}</span>
                </div>

                <div className="cl-connector">
                  <div className="cl-dot" />
                  {i < entries.length - 1 && <div className="cl-line" />}
                </div>

                <div className="cl-body">
                  <span className={`cl-tag cl-tag--${entry.tag}`}>{entry.version}</span>
                  <div className="cl-title">{entry.title}</div>
                  <ul className="cl-list">
                    {entry.changes.map((c, j) => <li key={j}>{c}</li>)}
                  </ul>
                </div>

              </div>
            ))}
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Changelogs;