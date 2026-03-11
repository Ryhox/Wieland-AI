import '../styles/Download.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

const requirements = [
  ['Node.js',    '≥ 18.0'],
  ['PostgreSQL', '≥ 15'],
  ['Ollama',     '≥ 0.3'],
  ['RAM',        '≥ 8 GB'],
  ['GPU',        'Optional, CUDA / Metal'],
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

const platforms = ['🪟 Windows', '🍎 macOS', '🐧 Linux'];

function Download({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header noSidebar />

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
              <div className="dl-main-title">Wieland AI Desktop</div>
              <div className="dl-main-meta">
                <span className="dl-badge dl-badge-version">v1.4.0</span>
                <span className="dl-badge dl-badge-date">Jun 2025</span>
                <span className="dl-badge dl-badge-size">~48 MB</span>
              </div>
              <div className="dl-main-desc">
                Universelles Installer-Paket für Windows, macOS und Linux.
                Enthält Setup-Assistent und Systemd-Service-Datei.
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

          <p className="dl-section-label">Integrität</p>
          <div className="dl-integrity">
            <span className="dl-integrity-label">SHA-256</span>
            <span className="dl-integrity-hash">
              a3f8c2d1e94b07f65c3a9182e0d4b7f2c1a8e3d09b6f41c7e2a5d8b3f0c9e1a4
            </span>
          </div>

          <div className="dl-notice">
            <span className="dl-notice-icon">🔒</span>
            <span className="dl-notice-text">
              <strong>Kein Tracking, keine Telemetrie.</strong> Wieland AI sendet keinerlei Daten
              an externe Server. Alle Modelle laufen lokal über Ollama — deine Gespräche
              verlassen niemals dein Gerät. Internetverbindung nur für den optionalen
              Mistral-Fallback erforderlich.
            </span>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Download;