import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import '../styles/Changelogs.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import Starfield from '../components/Starfield';
import Scene3D from '../components/Scene3D';
import { useAuth } from '../context/AuthContext';

gsap.registerPlugin(ScrollTrigger);

const entries = [
    {
    version: 'v0.1.6',
    date: '23 März 2026',
    tag: 'purple',
    title: 'Design & Content Update',
    changes: [
      'Bugfixes',
      'Design überarbeitet auf allen Seiten schon wieder',
      "Content-Update: Alle Texte überarbeitet, um Wieland AI's Persönlichkeit besser widerzuspiegeln",
      "GSAP inegration für animationen on scroll und mehr Dynamik",
      "Noch nicht zu frieden mit Changelogs designs, weitere Verbesserungen folgen in v0.1.7",
      "Max Plan geaddet und 2B Model",
      "Responive für Handy verbessert",
      "FAQ searchbar und filter",
    ],
  },
  {
    version: 'v0.1.5',
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
  const rootRef = useRef(null);
  const introDoneRef = useRef(false);
  const activeIndexRef = useRef(0);
  const timelineTriggerRef = useRef(null);
  const entryRefs = useRef([]);
  const clickTargetRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const goToIndex = (index) => {
    const safeIndex = Math.max(0, Math.min(entries.length - 1, index));
    setActiveIndex(safeIndex);

    const isDesktop = window.matchMedia('(min-width: 901px)').matches;
    if (isDesktop && timelineTriggerRef.current) {
      const st = timelineTriggerRef.current;
      const steps = Math.max(entries.length - 1, 1);
      const progress = safeIndex / steps;
      const target = st.start + (st.end - st.start) * progress;
      clickTargetRef.current = safeIndex;
      window.scrollTo({ top: target, behavior: 'auto' });
      requestAnimationFrame(() => {
        clickTargetRef.current = null;
      });
      return;
    }

    const targetEntry = entryRefs.current[safeIndex];
    if (targetEntry) {
      targetEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  useLayoutEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      introDoneRef.current = false;
      gsap.set('.cl-hero > *', { opacity: 0, y: 24 });
      gsap.set('.cl-page-wrapper #three-canvas', { transformOrigin: '50% 50%', opacity: 0 });
      gsap.set('.cl-page-wrapper #stars-canvas', { opacity: 0 });
      gsap.set('.cl-entry', { autoAlpha: 0, y: 36, scale: 0.96, filter: 'saturate(0.9)' });
      gsap.set('.cl-pagination-indicators .cl-page-dot, .cl-pagination-title', { opacity: 0, y: 16 });

      const entriesEls = gsap.utils.toArray('.cl-entry');
      const steps = Math.max(entriesEls.length - 1, 1);
      const isDesktop = window.matchMedia('(min-width: 901px)').matches;

      const setActiveEntry = (activeIndex) => {
        if (activeIndexRef.current !== activeIndex) {
          activeIndexRef.current = activeIndex;
          setActiveIndex(activeIndex);
        }

        entriesEls.forEach((entry, index) => {
          if (index === activeIndex) {
            gsap.to(entry, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              filter: 'saturate(1)',
              duration: 0.42,
              ease: 'power2.out',
              overwrite: true,
            });
          } else {
            gsap.to(entry, {
              autoAlpha: 0,
              y: 24,
              scale: 0.97,
              filter: 'saturate(0.9)',
              duration: 0.28,
              ease: 'power2.out',
              overwrite: true,
            });
          }
        });
      };

      gsap.timeline()
        .to('.cl-page-wrapper #stars-canvas', {
          opacity: 0.42,
          duration: 0.2,
          ease: 'power2.out',
        })
        .to('.cl-page-wrapper #three-canvas', {
          opacity: 0.14,
          duration: 0.4,
          ease: 'power2.out',
        }, 0)
        .to('.cl-hero > *', {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.08,
          ease: 'power3.out',
        }, '-=0.1')
        .to('.cl-entry:first-child', {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          filter: 'saturate(1)',
          duration: 0.5,
          ease: 'power3.out',
        }, '+=0.10')
        .to('.cl-pagination-indicators .cl-page-dot', {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.03,
          ease: 'power3.out',
        }, '+=0.1')
        .to('.cl-pagination-title', {
          opacity: 1,
          y: 0,
          duration: 0.5,
          ease: 'power3.out',
        }, '-=0.1')
        .add(() => {
          introDoneRef.current = true;
          setActiveEntry(0);
        });

      if (isDesktop) {
        const st = ScrollTrigger.create({
          trigger: '.cl-timeline',
          start: 'top top+=300',
          end: `+=${Math.max(steps * 90, 1)}%`,
          pin: true,
          scrub: 1,
          anticipatePin: 1,
          snap: steps > 0 ? 1 / steps : false,
          onUpdate: (self) => {
            if (!introDoneRef.current) return;

            if (clickTargetRef.current !== null) {
              setActiveEntry(clickTargetRef.current);
              return;
            }

            const raw = self.progress * steps;
            let idx = activeIndexRef.current;

            while (raw >= idx + 0.6 && idx < steps) idx += 1;
            while (raw <= idx - 0.6 && idx > 0) idx -= 1;

            setActiveEntry(idx);
          },
        });
        timelineTriggerRef.current = st;
      } else {
        gsap.set('.cl-entry', { autoAlpha: 1, scale: 1, filter: 'none' });
      }

      gsap.to('.cl-ambient-glow', {
        y: 28,
        x: -56,
        scale: 1.1,
        ease: 'none',
        scrollTrigger: {
          trigger: '.cl-page-wrapper',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1,
        },
      });
    }, rootRef);

    return () => {
      timelineTriggerRef.current = null;
      ctx.revert();
    };
  }, []);

  return (
    <div className={`page-wrapper content-page cl-page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`} ref={rootRef}>
      <div className="cl-bg-layer" aria-hidden="true">
        <Starfield />
        <Scene3D hasMessages={true} sceneMode="about" hidePlanet={true} />
        <div className="cl-ambient-glow" />
      </div>

      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content cl-content-layer">
        <div className="page-container cl-container">

          <div className="cl-hero">
            <span className="cl-eyebrow">Changelogs</span>
            <h1 className="cl-h1">Was ist<br /><span>neu?</span></h1>
            <p className="cl-lead">Alle Versionen, Fixes und Features — chronologisch dokumentiert.</p>
          </div>

          <div className="cl-timeline">
            <div className="cl-entries-track">
              {entries.map((entry, i) => (
                <div className="cl-entry" key={i} ref={(el) => { entryRefs.current[i] = el; }}>

                  <div className="cl-side">
                    <span className="cl-version">{entry.version}</span>
                    <span className="cl-date">{entry.date}</span>
                  </div>

                  <div className="cl-connector">
                    <div className="cl-line" />
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

          <div className="cl-pagination" aria-label="Changelog Pagination">
            <div className="cl-pagination-indicators">
              {entries.map((entry, i) => (
                <button
                  type="button"
                  key={entry.version + entry.title}
                  onClick={() => goToIndex(i)}
                  className={`cl-page-dot ${i === activeIndex ? 'cl-page-dot--active' : ''}`}
                  aria-label={`Gehe zu ${entry.title}`}
                  aria-current={i === activeIndex ? 'true' : 'false'}
                />
              ))}
            </div>
            <p className="cl-pagination-title">{entries[activeIndex]?.title}</p>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Changelogs;
