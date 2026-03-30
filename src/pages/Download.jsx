import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import '../styles/Download.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import Starfield from '../components/Starfield';
import Scene3D from '../components/Scene3D';
import { useAuth } from '../context/AuthContext';


const platforms = ['🌐 Chrome'];

function Download({ isSidebarOpen, onSidebarToggle }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap.set('.dl-page-wrapper #three-canvas', { transformOrigin: '50% 50%', opacity: 0 });
      gsap.set('.dl-page-wrapper #stars-canvas', { opacity: 0 });
      gsap.set('.dl-hero > *', { opacity: 0, y: 26 });
      gsap.set('.dl-main-card, .dl-platform-row', { opacity: 0, y: 30 });

      gsap.timeline()
        .to('.dl-page-wrapper #stars-canvas', { opacity: 0.42, duration: 0.2, ease: 'power2.out' })
        .to('.dl-page-wrapper #three-canvas', { opacity: 0.14, duration: 0.4, ease: 'power2.out' }, 0)
        .to('.dl-hero > *', {
          opacity: 1,
          y: 0,
          duration: 0.32,
          stagger: 0.06,
          ease: 'power3.out',
        }, '-=0.1')
        .to('.dl-main-card, .dl-platform-row', {
          opacity: 1,
          y: 0,
          duration: 0.28,
          stagger: 0.06,
          ease: 'power3.out',
        }, '-=0.08');
    }, rootRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <div className={`page-wrapper content-page dl-page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`} ref={rootRef}>
      <div className="dl-bg-layer" aria-hidden="true">
        <Starfield />
        <Scene3D hasMessages={true} sceneMode="about" hidePlanet={true} />
        <div className="dl-ambient-glow" />
      </div>

      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content dl-content-layer">
        <div className="page-container dl-container">

          <div className="dl-hero">
            <span className="dl-eyebrow">{t('download.eyebrow')}</span>
            <h1 className="dl-h1">{t('download.title')}<br /><span>{t('download.titleAccent')}</span></h1>
            <p className="dl-lead">
              {t('download.lead')}
            </p>
          </div>

          <div className="dl-main-card">
            <div className="dl-main-left">
              <div className="dl-main-title">{t('download.extensionTitle')}</div>
              <div className="dl-main-meta">
                <span className="dl-badge dl-badge-version">v1.4.0</span>
                <span className="dl-badge dl-badge-date">Jun 2025</span>
              </div>
              <div className="dl-main-desc">
                {t('download.desc')}
              </div>
            </div>

            <a href="#" className="dl-btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('download.button')}
            </a>
          </div>

          <div className="dl-platform-row">
            <span className="dl-platform-label">{t('download.runsOn')}</span>
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
