import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
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
          end: '+=140%',
          scrub: 1,
          pin: true,
          anticipatePin: 1,
        },
      })
        .to('.about-hero-left', {
          y: -84,
          opacity: 0.34,
          ease: 'none',
        }, 0)
        .to('.about-hero-right', {
          y: -34,
          scale: 0.94,
          opacity: 0.82,
          ease: 'none',
        }, 0)
        .to('.about-page-shell #three-canvas', {
          scale: 1.04,
          rotation: 3,
          y: -18,
          opacity: 0.18,
          filter: 'saturate(1.08) contrast(0.9)',
          ease: 'none',
        }, 0)
        .to('.about-page-shell #stars-canvas', {
          opacity: 0.42,
          ease: 'none',
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
            <div className="about-hero-left">
              <span className="about-eyebrow">Über Wieland AI</span>
              <h1 className="about-h1">Entwickelt für, <br /><span>das beste AI erlebnis</span></h1>
              <p className="about-lead">
                Wieland AI ist eine moderne AI mit Echtzeit-Antworten, visuellem Verständnis
                und Intelligenz. Gebaut für ein erstklassiges Online-Erlebnis.
              </p>
              <div className="about-hero-pills">
                <span className="about-pill">Echtzeit Streaming</span>
                <span className="about-pill">Vision + Text</span>
                <span className="about-pill">Skalierbare System</span>
              </div>
            </div>

            <div className="about-hero-right">
              <div className="about-stats">
                {[
                  { num: fmt(stats.total_users), label: 'Aktive Nutzer' },
                  { num: fmt(stats.total_chats), label: 'Chats' },
                  { num: fmt(stats.total_messages), label: 'Gesendete Nachrichten' },
                  { num: '24/7', label: 'Online Laufzeit' },
                ].map(s => (
                  <div className="about-stat-card" key={s.label}>
                    <div className="about-stat-num">{s.num}</div>
                    <div className="about-stat-label">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="about-divider about-reveal" />

          <p className="about-section-label about-reveal">Warum Wieland?</p>
          <div className="about-why-block about-reveal">
            <p className="about-why-lead">
              Andere AIs sind oft entweder zu simpel und unzuverlässig oder so komplex, dass sie mehr Zeit mit Setup und Fehlersuche als mit echter Produktivität verbringen.
            </p>
            <p className="about-why-body">
              Wieland AI vereint diesen Flow in einem einzigen schnellen Interface mit verlässlichen Outputs,
              intelligenten Model und einer UX, die sich vertraut anfühlt,
              als ein reines Tool.
            </p>
          </div>

          <div className="about-divider about-reveal" />

          <p className="about-section-label about-reveal">Unsere Kernbereiche</p>
          <div className="about-text-grid about-reveal">
            <div className="about-text-item">
              <h3>Startklare Erlebnisse</h3>
              <p>Vom ersten Prompt bis zum fertigen Workflow ist jede Interaktion darauf ausgelegt, sich flüssig, qualitativ hochwertig und sofort reagierend anzufühlen.</p>
            </div>
            <div className="about-text-item">
              <h3>Transparenz & Kontrolle</h3>
              <p>Transparenz, die Spaß macht: Du siehst, was passiert, und bestimmst, wie dein AI-Flow läuft.</p>
            </div>
            <div className="about-text-item">
              <h3>Echte Multimodalität</h3>
              <p>Volles Verständnis von Texten und Bildern in einem einzigen Durchlauf. Lade Kontext hoch, analysiere visuelle Inhalte und halte den Flow stetig am Laufen.</p>
            </div>
            <div className="about-text-item">
              <h3>Ohne Ausfälle skalieren</h3>
              <p>Unsere produktionsstarken Deployments stellen sicher, dass dein AI-Assistent auch unter extremen Last-Spitzen stabil bleibt.</p>
            </div>
          </div>

          <div className="about-divider about-reveal" />

          <p className="about-section-label about-reveal">Technologie Stack</p>
          <div className="about-stack about-reveal">
            {[
              { label: 'Frontend', tags: ['React', 'Vite', 'CSS', 'GSAP'] },
              { label: 'Backend', tags: ['Node.js', 'Express'] },
              { label: 'Daten', tags: ['PostgreSQL', 'JSON Storage'] },
              { label: 'AI Engine', tags: ['Qwen3-VL'] },
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
