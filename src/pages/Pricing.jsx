import { useState } from 'react';
import '../styles/Pricing.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import AuthModal from '../components/AuthModal';
import PaymentConfirmModal from '../components/PaymentConfirmModal';
import PurchaseModal from '../components/PurchaseModal';
import { useAuth } from '../context/AuthContext';

const CHECK = '✦';
const CROSS = '✕';

const FREE_FEATURES = [
  { text: 'Lokales Ollama-Modell (Qwen3-VL 4B)', enabled: true },
  { text: 'Unbegrenzte Gespräche', enabled: true },
  { text: 'Bild-Upload & Analyse', enabled: true },
  { text: 'Gesprächsverlauf', enabled: true },
  { text: 'Prioritäts-Support', enabled: false },
  { text: 'Lokales Ollama-Modell (Qwen3-VL 8B)', enabled: false },
];

const PRO_FEATURES = [
  { text: 'Unterstützt die Entwicklung von Wieland AI', enabled: true },
  { text: 'Prioritäts-Support', enabled: true },
  { text: 'Frühzeitiger Zugang zu neuen Releases', enabled: true },
  { text: 'Lokales Ollama-Modell (Qwen3-VL 8B)', enabled: true },
];

const FAQ = [
  {
    q: 'Werden meine Daten in der Cloud gespeichert?',
    a: 'Ja deine Chats sowie deine Nutzerdaten werden in unserer Datenbank gespeichert, damit du von all deinen Geräten auf deine Daten zugreifen kannst. Alle Daten werden jedoch verschlüsselt und sicher gespeichert.',
  },
  {
    q: 'Kann ich jederzeit kündigen?',
    a: 'Ja. Die Unterstützung ist monatlich kündbar, ohne Mindestlaufzeit oder versteckte Gebühren.',
  },
  {
    q: 'Gibt es einen Unterschied bei der Modellqualität?',
    a: 'Ja, Nutzer mit Pro können Zugang zu leistungsstärkeren Modellen haben.',
  },
];

function Pricing({ isSidebarOpen, onSidebarToggle }) {
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
  const [purchaseModal, setPurchaseModal] = useState(null);

  const handleUpgrade = () => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    setPaymentConfirmOpen(true);
  };

  const handleConfirmPayment = () => {
    setPaymentConfirmOpen(false);
    setPurchaseModal('Pro');
  };
  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      {paymentConfirmOpen && (
        <PaymentConfirmModal
          plan="Pro"
          price={4.99}
          onConfirm={handleConfirmPayment}
          onClose={() => setPaymentConfirmOpen(false)}
        />
      )}

      {purchaseModal && (
        <PurchaseModal
          plan={purchaseModal}
          onComplete={() => setPurchaseModal(null)}
          onClose={() => setPurchaseModal(null)}
        />
      )}

      <main className="page-content">
        <div className="page-container pricing-container">

          <div className="pricing-hero">
            <span className="pricing-eyebrow">Preise</span>
            <h1 className="pricing-h1">Einfach.<br /><span>Transparent.</span></h1>
            <p className="pricing-lead">
              Wieland AI ist für alle nutzbar, Anmelden und los geht es.<br></br>
              Wenn du aber noch mehr willst, upgrade zur Pro-Version
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
              <span className="pricing-badge">Pro</span>
              <div className="pricing-plan-name">Pro</div>
              <div className="pricing-price-row">
                <span className="pricing-price">4,99 €</span>
                <span className="pricing-price-period">/ Monat</span>
              </div>
              <p className="pricing-price-sub">
                Unterstütze die Entwicklung von Wieland AI.
              </p>

              <ul className="pricing-features">
                {PRO_FEATURES.map(f => (
                  <li key={f.text}>
                    <span className="feat-icon">{CHECK}</span>
                    {f.text}
                  </li>
                ))}
              </ul>

              <button className="pricing-btn btn-pro" onClick={handleUpgrade}>
                Upgrade
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