import { useState } from 'react';
import '../styles/FAQ.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

const faqData = [
  {
    q: 'Funktioniert Wieland AI wirklich ohne Internet?',
    a: 'Ja. Solange Ollama lokal läuft, verarbeitet Wieland AI alle Anfragen vollständig auf deinem Gerät.',
  },
  {
    q: 'Welche Modelle werden unterstützt?',
    a: 'Wieland AI unterstützt alle Ollama-kompatiblen Modelle. Standardmäßig sind Qwen3-VL-Varianten konfiguriert.',
  },
  {
    q: 'Kann ich Bilder in den Chat hochladen?',
    a: 'Ja, diese Bilder werden lokal verarbeitet und nicht extern gespeichert.',
  },
  {
    q: 'Was passiert mit meinen Chat-Verläufen?',
    a: 'Chats werden lokal in deiner PostgreSQL-Datenbank gespeichert. Es findet keine Synchronisation in die Cloud statt.',
  },
  {
    q: 'Auf welchen Betriebssystemen läuft Wieland AI?',
    a: 'Wieland AI läuft überall, wo Node.js, PostgreSQL und Ollama verfügbar sind — also auf Windows, macOS und Linux.',
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

function FAQ({ isSidebarOpen }) {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header noSidebar />

      <main className="page-content">
        <div className="page-container faq-container">

          <div className="faq-hero">
            <span className="faq-eyebrow">Häufige Fragen</span>
            <h1 className="faq-h1">Alles, was du<br /><span>wissen musst.</span></h1>
            <p className="faq-lead">Fragen zu Wieland AI? Hier findest du Antworten auf die häufigsten Themen.</p>
          </div>

          <div className="faq-list">
            {faqData.map((item, i) => (
              <FAQItem
                key={i}
                q={item.q}
                a={item.a}
                open={openIndex === i}
                onToggle={() => setOpenIndex(openIndex === i ? null : i)}
              />
            ))}
          </div>

          <p className="faq-footer-note">
            Noch Fragen? Schreib uns — das Team hilft gern weiter.
          </p>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default FAQ;