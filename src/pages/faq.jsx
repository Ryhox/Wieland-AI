import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useNavigate } from 'react-router-dom';
import '../styles/FAQ.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import Starfield from '../components/Starfield';
import Scene3D from '../components/Scene3D';
import { useAuth } from '../context/AuthContext';

const FAQ_FILTERS = ['Alle', 'Abo', 'Model', 'About'];

const faqData = [
  {
    q: 'Werden meine Daten sicher gespeichert?',
    a: 'Ja, alle Chats und Nutzerdaten werden verschlüsselt in der Cloud gespeichert, sodass du von jedem Gerät darauf zugreifen kannst.',
  },
  {
    q: 'Kann ich jederzeit kündigen?',
    a: 'Ja, alle Pläne sind monatlich kündbar, ohne versteckte Gebühren oder Mindestlaufzeit.',
  },
  {
    q: 'Welche Modellqualitäten gibt es?',
    a: 'Free bietet grundlegende Modelle, Pro Zugriff auf leistungsstärkere Modelle, Max die höchsten Modellqualitäten für komplexe Aufgaben.',
  },
  {
    q: 'Kann ich Bilder hochladen?',
    a: 'Ja, Wieland AI kann Bilder analysieren und direkt Fragen dazu beantworten.',
  },
  {
    q: 'Auf welchen Geräten funktioniert Wieland AI?',
    a: 'Alle modernen Browser auf Desktop- und mobilen Geräten werden unterstützt.',
  },
  {
    q: 'Wie schnell werden Antworten geliefert?',
    a: 'Antworten erfolgen in Echtzeit, auch bei komplexen Anfragen oder großen Datenmengen.',
  },
  {
    q: 'Kann ich Wieland AI im Team nutzen?',
    a: 'Nein, gerade ist Wieland AI für Einzelpersonen konzipiert. Teamfunktionen sind jedoch in Planung.',
  },
  {
    q: 'Wie aktuell ist das Wissen der AI?',
    a: 'Wieland AI hat kein aktuelles wissen jedoch ist eine Internetanbindung in Planung, um auch aktuelle Informationen bereitstellen zu können.',
  },
  {
    q: 'Gibt es Nutzungsgrenzen?',
    a: 'Die Nutzung ist praktisch unbegrenzt. Selbst bei hohem Traffic sorgen wir für stabile Leistung.',
  },
  {
    q: 'Gibt es eine Testversion für Pro oder Max?',
    a: 'Nein, du kannst Pro oder Max nicht für einen begrenzten Zeitraum testen.',
  },
  {
    q: 'Kann ich zwischen Plänen jederzeit wechseln?',
    a: 'Ja, Upgrades oder Downgrades erfolgen jederzeit nahtlos. ',
  },
  {
    q: 'Wie funktioniert der Prioritäts-Support?',
    a: 'Pro- und Max-Nutzer erhalten schnellere Antworten auf Anfragen und Hilfestellungen vom Team.',
  },
  {
    q: 'Welche Funktionen bietet Max?',
    a: 'Max liefert die leistungsstärksten Modelle für präziseste Antworten, schnelle Verarbeitung und komplexe Analysen.',
  },
  {
    q: 'Kann ich den Chat-Verlauf exportieren?',
    a: 'Nein, derzeit gibt es keine Exportfunktion für Chat-Verläufe.',
  },
  {
    q: 'Gibt es eine Obergrenze für Bilder?',
    a: 'Ja, maximal ein Bild pro Anfrage kann hochgeladen und analysiert werden.',
  },
  {
    q: 'Welche Sprachen unterstützt Wieland AI?',
    a: 'Wieland AI unterstützt mehrere Sprachen und kann nahtlos zwischen ihnen wechseln.',
  },
  {
    q: 'Wie oft werden Modelle aktualisiert?',
    a: 'Regelmäßig: Neue Versionen und Verbesserungen werden kontinuierlich ausgerollt.',
  },
  {
    q: 'Kann ich Wieland AI auf Smartphones nutzen?',
    a: 'Ja, die Plattform funktioniert auf allen modernen Smartphones und Tablets.',
  },
  {
    q: 'Unterstützt Wieland AI Text- und Bildanalyse gleichzeitig?',
    a: 'Ja, unsere Multimodal-Funktion analysiert Text und Bilder in einem einzigen Durchlauf.',
  },
  {
    q: 'Kann ich meine Daten löschen lassen?',
    a: 'Ja, du kannst jederzeit alle gespeicherten Daten löschen lassen – wir respektieren deine Privatsphäre.',
  },
  {
    q: 'Wie zuverlässig ist die AI?',
    a: 'Wieland AI liefert konsistente Ergebnisse, selbst bei komplexen Fragen oder größeren Projekten.',
  },
  {
    q: 'Kann ich mehrere Projekte gleichzeitig bearbeiten?',
    a: 'Ja, Wieland AI unterstützt parallele Chats und Projekte ohne Einschränkungen.',
  },
  {
    q: 'Wie schnell werden Updates eingespielt?',
    a: 'Updates werden automatisch ausgerollt, ohne dass du etwas installieren musst.',
  },
  {
    q: 'Kann ich AI-Antworten anpassen?',
    a: 'Ja, du kannst Ton, Detailgrad und Stil der Antworten nach Bedarf einstellen.',
  },
  {
    q: 'Ist die Plattform immer online verfügbar?',
    a: 'Ja, unsere Infrastruktur garantiert 24/7 Verfügbarkeit mit stabiler Performance.',
  },
  {
    q: 'Kann ich Benachrichtigungen erhalten?',
    a: 'Nein, derzeit gibt es keine Benachrichtigungsfunktion für neue Antworten oder Updates.',
  },
  {
    q: 'Unterstützt Wieland AI API-Zugriff?',
    a: 'Nein da Wieland AI selbst auf einer basiert.',
  },
  {
    q: 'Gibt es eine Limitierung für gleichzeitige Anfragen?',
    a: 'Nein, die Plattform ist skalierbar und verarbeitet viele Anfragen gleichzeitig.',
  },
  {
    q: 'Wie einfach ist der Einstieg für neue Nutzer?',
    a: 'Sehr einfach: Keine Installation nötig, direkt im Browser starten und loslegen.',
  },
  {
    q: 'Gibt es Anleitungen oder Tutorials?',
    a: 'Nein, es gibt keine offiziellen Anleitungen oder Tutorials, aber unser Support-Team hilft gerne weiter.',
  },
  {
    q: 'Wie sicher ist die Plattform vor Hackerangriffen?',
    a: 'Unsere Systeme nutzen moderne Sicherheitsstandards inklusive Verschlüsselung und Monitoring rund um die Uhr.',
  },
];

function FAQItem({ q, a, open, onToggle }) {
  return (
    <div className={`faq-item ${open ? 'faq-item--open' : ''}`}>
      <button className="faq-q" onClick={onToggle}>
        <span>{q}</span>
        <svg
          className={`faq-chevron ${open ? 'faq-chevron--open' : ''}`}
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className={`faq-answer ${open ? 'faq-answer--open' : ''}`}>
        <p className="faq-answer-text">{a}</p>
      </div>
    </div>
  );
}

function FAQ({ isSidebarOpen, onSidebarToggle }) {
  const { user } = useAuth();
  const rootRef = useRef(null);
  const [openQuestion, setOpenQuestion] = useState(null);
  const [activeFilter, setActiveFilter] = useState('Alle');
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const getCategory = (item) => {
    const source = `${item.q} ${item.a}`.toLowerCase();
    if (/abo|kündig|upgrade|downgrade|plan|preis|max|pro|free/.test(source)) return 'Abo';
    if (/modell|model|2b|4b|8b|multimodal/.test(source)) return 'Model';
    return 'About';
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredFaq = faqData.filter((item) => {
    const categoryOk = activeFilter === 'Alle' || getCategory(item) === activeFilter;
    const searchOk = !normalizedQuery
      || item.q.toLowerCase().includes(normalizedQuery)
      || item.a.toLowerCase().includes(normalizedQuery);
    return categoryOk && searchOk;
  });

  useLayoutEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap.set('.faq-page-wrapper #three-canvas', { transformOrigin: '50% 50%', opacity: 0 });
      gsap.set('.faq-page-wrapper #stars-canvas', { opacity: 0 });
      gsap.set('.faq-hero > *', { opacity: 0, y: 26 });
      gsap.set('.faq-tools', { opacity: 0, y: 20 });
      gsap.set('.faq-list', { opacity: 0, y: 18 });
      gsap.set('.faq-list .faq-item', { opacity: 0, y: 30 });
      gsap.set('.faq-list .faq-item', { backgroundColor: 'rgba(255, 255, 255, 0)' });
      gsap.set('.faq-footer-note', { opacity: 0, y: 20 });

      gsap.timeline()
        .to('.faq-page-wrapper #stars-canvas', { opacity: 0.42, duration: 0.3, ease: 'power2.out' })
        .to('.faq-page-wrapper #three-canvas', { opacity: 0.14, duration: 0.5, ease: 'power2.out' }, 0)
        .to('.faq-hero > *', {
          opacity: 1,
          y: 0,
          duration: 0.55,
          stagger: 0.07,
          ease: 'power3.out',
        }, '-=0.2')
        .to('.faq-tools', {
          opacity: 1,
          y: 0,
          duration: 0.28,
          ease: 'power2.out',
        }, '-=0.06')
        .to('.faq-list', {
          opacity: 1,
          y: 0,
          duration: 0.3,
          ease: 'power2.out',
        }, '-=0.06')
        .to('.faq-list .faq-item', {
          opacity: 1,
          y: 0,
          duration: 0.28,
          stagger: 0.04,
          ease: 'power3.out',
        }, '-=0.08')
        .to('.faq-list .faq-item', {
          backgroundColor: 'rgba(255, 255, 255, 0.035)',
          duration: 0.34,
          stagger: 0.04,
          ease: 'power2.out',
          clearProps: 'backgroundColor',
        }, '-=0.18')
        .to('.faq-footer-note', {
          opacity: 1,
          y: 0,
          duration: 0.26,
          ease: 'power3.out',
        }, '-=0.06');
    }, rootRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <div className={`page-wrapper content-page faq-page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`} ref={rootRef}>
      <div className="faq-bg-layer" aria-hidden="true">
        <Starfield />
        <Scene3D hasMessages={true} sceneMode="about" hidePlanet={true} />
        <div className="faq-ambient-glow" />
      </div>
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content faq-content-layer">
        <div className="page-container faq-container">

          <div className="faq-hero">
            <span className="faq-eyebrow">Häufige Fragen</span>
            <h1 className="faq-h1">Alles, was du<br /><span>wissen musst.</span></h1>
            <p className="faq-lead">Fragen zu Wieland AI? Hier findest du Antworten auf die häufigsten Themen.</p>
          </div>

          <div className="faq-tools" role="search">
            <div className="faq-search-wrap">
              <input
                type="text"
                className="faq-search"
                placeholder="Frage suchen..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setOpenQuestion(null);
                }}
                aria-label="FAQ Suche"
              />
            </div>
            <div className="faq-filter-row" aria-label="FAQ Filter">
              {FAQ_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`faq-filter-pill ${activeFilter === filter ? 'active' : ''}`}
                  onClick={() => {
                    setActiveFilter(filter);
                    setOpenQuestion(null);
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          <div className="faq-list">
            {filteredFaq.map((item) => (
              <FAQItem
                key={item.q}
                q={item.q}
                a={item.a}
                open={openQuestion === item.q}
                onToggle={() => setOpenQuestion(openQuestion === item.q ? null : item.q)}
              />
            ))}
            {filteredFaq.length === 0 && (
              <div className="faq-empty-state">
                Keine Ergebnisse gefunden. Probiere andere Suchbegriffe oder einen anderen Filter.
              </div>
            )}
          </div>

          <p className="faq-footer-note">
            Noch Fragen? <button onClick={() => navigate('/contact')} className="faq-contact-link">Schreib uns</button> — das Team hilft gern weiter.
          </p>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default FAQ;
