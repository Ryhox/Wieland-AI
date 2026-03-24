import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useNavigate } from 'react-router-dom';
import '../styles/Pricing.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import AuthModal from '../components/AuthModal';
import PaymentConfirmModal from '../components/PaymentConfirmModal';
import PurchaseModal from '../components/PurchaseModal';
import Starfield from '../components/Starfield';
import Scene3D from '../components/Scene3D';
import { useAuth } from '../context/AuthContext';

const CHECK = '✦';
const CROSS = '✕';

const FREE_FEATURES = [
  { text: 'Wieland 2B Modell', enabled: true },
  { text: 'Unbegrenzte Gespräche', enabled: true },
  { text: 'Bild-Upload & Analyse', enabled: true },
  { text: 'Gesprächsverlauf', enabled: true },
  { text: 'Prioritäts-Support', enabled: false },
  { text: 'Wieland 4B Modell', enabled: false },
  { text: 'Wieland 8B Modell', enabled: false },
];

const PRO_FEATURES = [
  { text: 'Alles aus Kostenlos', enabled: true },
  { text: 'Unterstützt die Entwicklung von Wieland AI', enabled: true },
  { text: 'Prioritäts-Support', enabled: true },
  { text: 'Frühzeitiger Zugang zu neuen Releases', enabled: true },
  { text: 'Wieland4B Modell', enabled: true },
  { text: 'Wieland 8B Modell', enabled: false },
];

const MAX_FEATURES = [
  { text: 'Alles aus Pro', enabled: true },
  { text: 'Beste Modellqualität mit Wieland 8B Modell ', enabled: true },
  { text: 'Prioritäts-Support', enabled: true },
  { text: 'Frühzeitiger Zugang zu neuen Releases', enabled: true },
];

const PLAN_ORDER = { free: 0, pro: 1, max: 2, admin: 3 };

const normalizePlan = (plan) => {
  const value = String(plan || 'Free').toLowerCase();
  if (value === 'admin') return 'admin';
  if (value === 'max') return 'max';
  if (value === 'pro') return 'pro';
  return 'free';
};

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
    a: 'Ja, Nutzer mit Pro oder Max können Zugang zu leistungsstärkeren Modellen haben. Wobei Max die beste Qualität mit Wieland 8B bietet, ideal für komplexe Anfragen und detaillierte Antworten.',
  },
];

function Pricing({ isSidebarOpen, onSidebarToggle }) {
  const { user, authFetch, setUser } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
  const [purchaseModal, setPurchaseModal] = useState(null);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [isPlanUpdating, setIsPlanUpdating] = useState(false);

  useLayoutEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap.set('.pricing-page-wrapper #three-canvas', { transformOrigin: '50% 50%', opacity: 0 });
      gsap.set('.pricing-page-wrapper #stars-canvas', { opacity: 0 });
      gsap.set('.pricing-hero > *', { opacity: 0, y: 26 });
      gsap.set('.pricing-section-label, .pricing-card, .pricing-divider, .pricing-faq-item', { opacity: 0, y: 30 });

      gsap.timeline()
        .to('.pricing-page-wrapper #stars-canvas', { opacity: 0.42, duration: 0.2, ease: 'power2.out' })
        .to('.pricing-page-wrapper #three-canvas', { opacity: 0.14, duration: 0.4, ease: 'power2.out' }, 0)
        .to('.pricing-hero > *', {
          opacity: 1,
          y: 0,
          duration: 0.32,
          stagger: 0.06,
          ease: 'power3.out',
        }, '-=0.1')
        .to('.pricing-section-label, .pricing-card, .pricing-divider, .pricing-faq-item', {
          opacity: 1,
          y: 0,
          duration: 0.28,
          stagger: 0.04,
          ease: 'power3.out',
        }, '-=0.08');
    }, rootRef);

    return () => {
      ctx.revert();
    };
  }, []);

  const currentPlan = normalizePlan(user?.plan);
  const isAdminPlan = currentPlan === 'admin';

  const getPlanAction = (targetPlan) => {
    if (isAdminPlan) return 'admin-locked';
    const target = normalizePlan(targetPlan);
    const current = currentPlan;
    if (target === current) return 'manage';
    return PLAN_ORDER[target] > PLAN_ORDER[current] ? 'upgrade' : 'downgrade';
  };

  const applyPlanChange = async (targetPlan) => {
    setIsPlanUpdating(true);
    try {
      const res = await authFetch('/api/auth/upgrade-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: targetPlan }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Plan konnte nicht aktualisiert werden.');
        return;
      }
      const data = await res.json();
      setUser(data.user);
    } catch {
      alert('Plan konnte nicht aktualisiert werden.');
    } finally {
      setIsPlanUpdating(false);
    }
  };

  const handlePlanAction = (targetPlan) => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }

    const action = getPlanAction(targetPlan);

    if (action === 'manage') {
      navigate('/profile');
      return;
    }

    if (action === 'admin-locked') {
      return;
    }

    if (action === 'downgrade') {
      const confirmed = window.confirm(`Möchtest du wirklich auf ${targetPlan} wechseln?`);
      if (!confirmed) return;
      applyPlanChange(targetPlan);
      return;
    }

    setPendingPlan(targetPlan);
    setPaymentConfirmOpen(true);
  };

  const handleConfirmPayment = () => {
    setPaymentConfirmOpen(false);
    if (pendingPlan) {
      setPurchaseModal(pendingPlan);
    }
  };

  const getButtonLabel = (targetPlan) => {
    const action = getPlanAction(targetPlan);
    if (action === 'admin-locked') return 'Nicht möglich (Admin)';
    if (action === 'manage') return 'Verwalten';
    if (action === 'downgrade') return 'Downgrade';
    return 'Upgrade';
  };

  const planPrice = pendingPlan === 'Max' ? 9.99 : 4.99;

  return (
    <div className={`page-wrapper content-page pricing-page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`} ref={rootRef}>
      <div className="pricing-bg-layer" aria-hidden="true">
        <Starfield />
        <Scene3D hasMessages={true} sceneMode="about" hidePlanet={true} />
        <div className="pricing-ambient-glow" />
      </div>

      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      {paymentConfirmOpen && (
        <PaymentConfirmModal
          plan={pendingPlan || 'Pro'}
          price={planPrice}
          onConfirm={handleConfirmPayment}
          onClose={() => {
            setPaymentConfirmOpen(false);
            setPendingPlan(null);
          }}
        />
      )}

      {purchaseModal && (
        <PurchaseModal
          plan={purchaseModal}
          onComplete={() => {
            setPurchaseModal(null);
            setPendingPlan(null);
          }}
          onClose={() => {
            setPurchaseModal(null);
            setPendingPlan(null);
          }}
        />
      )}

      <main className="page-content pricing-content-layer">
        <div className="page-container pricing-container">

          <div className="pricing-hero">
            <span className="pricing-eyebrow">Preise</span>
            <h1 className="pricing-h1">Einfach.<br /><span>Transparent.</span></h1>
            <p className="pricing-lead">
              Wieland AI ist für alle nutzbar, Anmelden und los geht es.<br></br>
              Wenn du aber noch mehr willst, upgrade zur Pro- oder Max-Version
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

              <button
                className="pricing-btn btn-ghost"
                onClick={() => handlePlanAction('Free')}
                disabled={isPlanUpdating || isAdminPlan}
              >
                {getButtonLabel('Free')}
              </button>
            </div>

            <div className="pricing-card featured">
              <span className="pricing-recommended-badge">Empfohlen</span>
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
                  <li key={f.text} className={!f.enabled ? 'feat-disabled' : ''}>
                    <span className="feat-icon">{f.enabled ? CHECK : CROSS}</span>
                    {f.text}
                  </li>
                ))}
              </ul>

              <button
                className="pricing-btn btn-pro"
                onClick={() => handlePlanAction('Pro')}
                disabled={isPlanUpdating || isAdminPlan}
              >
                {getButtonLabel('Pro')}
              </button>
            </div>

            <div className="pricing-card">
              <span className="pricing-badge">Max</span>
              <div className="pricing-plan-name">Max</div>
              <div className="pricing-price-row">
                <span className="pricing-price">9,99 €</span>
                <span className="pricing-price-period">/ Monat</span>
              </div>
              <p className="pricing-price-sub">
                Maximale Qualität mit Wieland 8B.
              </p>

              <ul className="pricing-features">
                {MAX_FEATURES.map(f => (
                  <li key={f.text}>
                    <span className="feat-icon">{CHECK}</span>
                    {f.text}
                  </li>
                ))}
              </ul>

              <button
                className="pricing-btn btn-pro"
                onClick={() => handlePlanAction('Max')}
                disabled={isPlanUpdating || isAdminPlan}
              >
                {getButtonLabel('Max')}
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
