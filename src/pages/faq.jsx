import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/FAQ.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

const faqData = [
  {
    q: 'Funktioniert Wieland AI?',
    a: 'Ja. Solange Ollama lokal läuft, verarbeitet Wieland AI alle Anfragen vollständig auf deinem Gerät.',
  },
  {
    q: 'Welche Modelle werden unterstützt?',
    a: 'Momentan werden Qwen3-VL 8B und 4B unterstützt.',
  },
  {
    q: 'Kann ich Bilder in den Chat hochladen?',
    a: 'Ja, Qwen3-VL unterstützt die Analyse von Bildern. Du kannst Bilder hochladen und Fragen dazu stellen.',
  },
  {
    q: 'Was passiert mit meinen Chat-Verläufen?',
    a: 'Chats werden sicher in unserer Datenbank gespeichert, damit du von all deinen Geräten auf deine Daten zugreifen kannst. Alle Daten werden jedoch verschlüsselt und sicher gespeichert.',
  },
  {
    q: 'Auf welchen Betriebssystemen läuft Wieland AI?',
    a: 'Wieland AI läuft in jdedem modernen Browser, damit ist es plattformunabhängig und funktioniert auf Windows, macOS und Linux.',
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
  const [openIndex, setOpenIndex] = useState(null);
  const navigate = useNavigate();

  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

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
            Noch Fragen? <button onClick={() => navigate('/contact')} className="faq-contact-link">Schreib uns</button> — das Team hilft gern weiter.
          </p>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default FAQ;