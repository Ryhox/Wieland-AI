import '../styles/Pricing.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

const CHECK = '✦';
const CROSS = '✕';

const FREE_FEATURES = [
  { text: 'Lokales Ollama-Modell (Qwen3-VL 2B)', enabled: true },
  { text: 'Unbegrenzte Gespräche', enabled: true },
  { text: 'Bild-Upload & Analyse', enabled: true },
  { text: 'Gesprächsverlauf', enabled: true },
  { text: 'Prioritäts-Support', enabled: false },
  { text: 'Lokales Ollama-Modell (Qwen3-VL 8B)', enabled: false },
];

const SUPPORT_FEATURES = [
  { text: 'Unterstützt die Entwicklung von Wieland AI', enabled: true },
  { text: 'Prioritäts-Support', enabled: true },
  { text: 'Frühzeitiger Zugang zu neuen Releases', enabled: true },
];

const FAQ = [
  {
    q: 'Werden meine Daten in der Cloud gespeichert?',
    a: 'Nein. Wieland AI läuft vollständig lokal auf deinem Gerät. Solange du offline bist, verlässt kein einziger Token dein System.',
  },
  {
    q: 'Kann ich jederzeit kündigen?',
    a: 'Ja. Die Unterstützung ist monatlich kündbar, ohne Mindestlaufzeit oder versteckte Gebühren.',
  },
  {
    q: 'Gibt es einen Unterschied bei der Modellqualität?',
    a: 'Nein. Alle Nutzer verwenden dieselben lokalen Modelle. Support dient ausschließlich zur Unterstützung der Entwicklung.',
  },
];

function Pricing({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header noSidebar />

      <main className="page-content">
        <div className="page-container pricing-container">

          <div className="pricing-hero">
            <span className="pricing-eyebrow">Preise</span>
            <h1 className="pricing-h1">Einfach.<br /><span>Transparent.</span></h1>
            <p className="pricing-lead">
              Wieland AI ist für alle nutzbar — kostenlos und vollständig lokal.
              Wenn dir das Projekt gefällt, kannst du die Entwicklung unterstützen.
            </p>
          </div>

          <p className="pricing-section-label">Pläne</p>
          <div className="pricing-plans">

            <div className="pricing-card">
              <span className="pricing-badge free-badge">Free</span>
              <div className="pricing-plan-name">Kostenlos</div>
              <div className="pricing-price-row">
                <span className="pricing-price">0 €</span>
                <span className="pricing-price-period">/ Monat</span>
              </div>
              <p className="pricing-price-sub">Für immer kostenlos.</p>

              <ul className="pricing-features">
                {FREE_FEATURES.map(f => (
                  <li key={f.text} className={!f.enabled ? 'feat-disabled' : ''}>
                    <span className="feat-icon">{f.enabled ? CHECK : CROSS}</span>
                    {f.text}
                  </li>
                ))}
              </ul>
            </div>

            <div className="pricing-card featured">
              <span className="pricing-badge">Support</span>
              <div className="pricing-plan-name">Support</div>
              <div className="pricing-price-row">
                <span className="pricing-price">4,99 €</span>
                <span className="pricing-price-period">/ Monat</span>
              </div>
              <p className="pricing-price-sub">
                Unterstütze die Entwicklung von Wieland AI.
              </p>

              <ul className="pricing-features">
                {SUPPORT_FEATURES.map(f => (
                  <li key={f.text}>
                    <span className="feat-icon">{CHECK}</span>
                    {f.text}
                  </li>
                ))}
              </ul>

              <button className="pricing-btn btn-pro">
                Projekt unterstützen
              </button>
            </div>

          </div>

          <div className="pricing-divider" />

          <p className="pricing-section-label">Häufige Fragen</p>
          <div className="pricing-faq">
            {FAQ.map(item => (
              <div className="pricing-faq-item" key={item.q}>
                <div className="pricing-faq-q">{item.q}</div>
                <div className="pricing-faq-a">{item.a}</div>
              </div>
            ))}
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Pricing;