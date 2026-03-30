import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useTranslation } from 'react-i18next';
import '../styles/About.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import Starfield from '../components/Starfield';
import Scene3D from '../components/Scene3D';
import { useAuth } from '../context/AuthContext';

gsap.registerPlugin(ScrollTrigger);

function About({ isSidebarOpen, onSidebarToggle }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const rootRef = useRef(null);
  const pageProgressRef = useRef(0);
  const sceneSpinRef = useRef(0);
  const [sceneProgress, setSceneProgress] = useState(0);
  const [sceneSpin, setSceneSpin] = useState(0);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const introTl = useRef(null);
  const [stats, setStats] = useState({ total_users: null, total_chats: null, total_messages: null });

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap.set('.about-page-shell #three-canvas', { transformOrigin: '50% 50%', opacity: 0 });
      gsap.set('.about-page-shell #stars-canvas', { opacity: 0 });
      gsap.set('.about-hero-left > *', { opacity: 0, y: 26 });
      gsap.set('.about-stat-card', { opacity: 0, y: 30 });

      introTl.current = gsap.timeline({ paused: true })
        .to('.about-page-shell #stars-canvas', { opacity: 0.42, duration: 0, ease: 'power2.out' })
        .to('.about-page-shell #three-canvas', { opacity: 0.14, duration: 0.4, ease: 'power2.out' }, 0)
        .to('.about-hero-left > *', {
          opacity: 1,
          y: 0,
          duration: 0.2,
          stagger: 0.04,
          ease: 'power3.out',
        }, "-=0.1")
        .to('.about-stat-card', {
          opacity: 1,
          y: 0,
          duration: 0.2,
          stagger: 0.04,
          ease: 'power3.out',
        }, "-=0.1");

      gsap.utils.toArray('.about-reveal').forEach((item) => {
        gsap.from(item, {
          opacity: 0,
          y: 60,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: item,
            start: 'top 82%',
            toggleActions: 'play none none reverse',
          },
        });
      });

      gsap.utils.toArray('.about-card, .about-stack-card').forEach((item) => {
        gsap.fromTo(item, {
          y: 30,
        }, {
          y: -20,
          ease: 'none',
          scrollTrigger: {
            trigger: item,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        });
      });

      gsap.timeline({
        scrollTrigger: {
          trigger: '.about-hero',
          start: 'top top+=68',
          end: '+=130%',
          scrub: 1,
          pin: true,
          anticipatePin: 1,
          pinSpacing: true,
        },
      })
        .to('.about-hero-inner', {
          y: -60,
          opacity: 0,
          ease: 'power2.in',
          duration: 0.8,
        }, 0)
        .to('.about-page-shell #three-canvas', {
          scale: 1.05,
          y: -16,
          opacity: 0.06,
          ease: 'power1.inOut',
          duration: 0.8,
        }, 0)
        .to('.about-page-shell #stars-canvas', {
          opacity: 0.1,
          ease: 'power1.inOut',
          duration: 0.8,
        }, 0);

      ScrollTrigger.create({
        trigger: '.about-page-shell',
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: (self) => {
          setSceneProgress(self.progress);
        },
      });
    }, rootRef);

    const handleScroll = () => setSceneSpin(window.scrollY * 0.0002);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      ctx.revert();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (isSceneReady && introTl.current) {
      introTl.current.play();
    }
  }, [isSceneReady]);

  const fmt = (n) => n === null ? '…' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  const coreItems = t('about.core', { returnObjects: true });

  return (
    <div className={`page-wrapper content-page about-page-shell ${isSidebarOpen ? 'sidebar-open' : ''}`} ref={rootRef}>
      <div className="about-bg-layer" aria-hidden="true">
        <Starfield />
        <Scene3D hasMessages={true} sceneMode="about" sceneProgress={sceneProgress} sceneSpin={sceneSpin} onReady={() => setIsSceneReady(true)} />
        <div className="about-ambient-glow" />
      </div>

      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content about-content-layer">
        <div className="page-container about-container">

          <div className="about-hero about-reveal">
            <div className="about-hero-inner">
              <div className="about-hero-left">
                <span className="about-eyebrow">{t('about.eyebrow')}</span>
                <h1 className="about-h1">{t('about.title')} <br /><span>{t('about.titleAccent')}</span></h1>
                <p className="about-lead">
                  {t('about.lead')}
                </p>
                <div className="about-hero-pills">
                  {(t('about.pills', { returnObjects: true }) || []).map((pill) => (
                    <span className="about-pill" key={pill}>{pill}</span>
                  ))}
                </div>
              </div>

              <div className="about-hero-right">
                <div className="about-stats">
                  {[
                    { key: 'activeUsers', num: fmt(stats.total_users), label: t('about.stats.activeUsers') },
                    { key: 'chats', num: fmt(stats.total_chats), label: t('about.stats.chats') },
                    { key: 'sentMessages', num: fmt(stats.total_messages), label: t('about.stats.sentMessages') },
                    { key: 'uptime', num: '24/7', label: t('about.stats.uptime') },
                  ].map(s => (
                    <div className="about-stat-card" key={s.key}>
                      <div className="about-stat-num">{s.num}</div>
                      <div className="about-stat-label">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="about-divider about-reveal" />

          <p className="about-section-label about-reveal">{t('about.whyLabel')}</p>
          <div className="about-why-block about-reveal">
            <p className="about-why-lead">
              {t('about.whyLead')}
            </p>
            <p className="about-why-body">
              {t('about.whyBody')}
            </p>
          </div>

          <div className="about-divider about-reveal" />

          <p className="about-section-label about-reveal">{t('about.coreLabel')}</p>
          <div className="about-text-grid about-reveal">
            {(Array.isArray(coreItems) ? coreItems : []).map((item) => (
              <div className="about-text-item" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>

          <div className="about-divider about-reveal" />

          <p className="about-section-label about-reveal">{t('about.stackLabel')}</p>
          <div className="about-stack about-reveal">
            {[
              { label: t('about.stack.frontend'), tags: ['React', 'Vite', 'CSS', 'GSAP'] },
              { label: t('about.stack.backend'), tags: ['Node.js', 'Express'] },
              { label: t('about.stack.data'), tags: ['PostgreSQL', 'JSON Storage'] },
              { label: t('about.stack.ai'), tags: ['Qwen3-VL'] },
            ].map(s => (
              <div className="about-stack-card" key={s.label}>
                <span className="about-stack-label">{s.label}</span>
                <div className="about-stack-tags">
                  {s.tags.map(t => <span className="about-tag" key={t}>{t}</span>)}
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

export default About;