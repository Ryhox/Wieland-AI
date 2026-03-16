import '../styles/Download.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

const requirements = [
  ['Node.js', '≥ 18.0'],
  ['PostgreSQL', '≥ 15'],
  ['Ollama', '≥ 0.3'],
  ['RAM', '≥ 8 GB'],
  ['GPU', 'Optional, CUDA / Metal'],
];

const changelog = [
  {
    version: 'v1.4.0',
    items: [
      'Mistral-Fallback bei fehlender Ollama-Verbindung',
      'Token-Budget-Tracker mit monatlichem Limit',
      'Admin-Dashboard mit Recharts-Visualisierungen',
      'Inline AuthModal ersetzt separate Login-Seiten',
    ],
  },
  {
    version: 'v1.3.0',
    items: [
      'SSE-Streaming für alle Modelle',
      'JWT-Authentifizierung & bcrypt',
      'Glassmorphism-Redesign der gesamten UI',
    ],
  },
  {
    version: 'v1.2.0',
    items: [
      'PostgreSQL-Migration von SQLite',
      'Mehrbenutzer-Support & Rollenverwaltung',
    ],
  },
];

const platforms = ['🌐 Chrome'];

function Download({ isSidebarOpen, onSidebarToggle }) {
  const { user } = useAuth();
  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content">
        <div className="page-container dl-container">

          <div className="dl-hero">
            <span className="dl-eyebrow">Download</span>
            <h1 className="dl-h1">Wieland AI<br /><span>herunterladen.</span></h1>
            <p className="dl-lead">
              Lokal, offline, ohne Telemetrie. Läuft vollständig auf deiner Hardware —
              keine Cloud, keine Abhängigkeiten von Drittservern.
            </p>
          </div>

          <div className="dl-main-card">
            <div className="dl-main-left">
              <div className="dl-main-title">Wieland AI Chrome Extension</div>
              <div className="dl-main-meta">
                <span className="dl-badge dl-badge-version">v1.4.0</span>
                <span className="dl-badge dl-badge-date">Jun 2025</span>
              </div>
              <div className="dl-main-desc">
                Nutze Wieland AI überall im Browser.
              </div>
            </div>

            <a href="#" className="dl-btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
          </div>

          <div className="dl-platform-row">
            <span className="dl-platform-label">Läuft auf</span>
            {platforms.map(p => (
              <span className="dl-platform-pill" key={p}>{p}</span>
            ))}
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Download;