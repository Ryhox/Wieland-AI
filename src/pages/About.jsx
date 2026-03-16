import { useState, useEffect } from 'react';

import '../styles/About.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

function About({ isSidebarOpen, onSidebarToggle }) {
  const { user } = useAuth();
  const [stats, setStats] = useState({ total_users: null, total_chats: null, total_messages: null });

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => { });
  }, []);

  const fmt = (n) => n === null ? '…' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content">
        <div className="page-container about-container">

          <div className="about-hero">
            <span className="about-eyebrow">Über uns</span>
            <h1 className="about-h1">Intelligenz,<br /><span>lokal gedacht.</span></h1>
            <p className="about-lead">
              Wieland AI ist ein einzigartiger KI-Assistent
            </p>
          </div>

          <div className="about-stats">
            {[
              { num: 'Browser-Extension', label: 'Downloade Jetzt!' },
              { num: 'Schnell & Schlau', label: 'Performance' },
              { num: 'Supportet Bild & Text', label: 'VLM' },
              { num: fmt(stats.total_users), label: 'Nutzer' },
              { num: fmt(stats.total_chats), label: 'Gespräche' },
              { num: fmt(stats.total_messages), label: 'Nachrichten' },
            ].map(s => (
              <div className="about-stat-card" key={s.label}>
                <div className="about-stat-num">{s.num}</div>
                <div className="about-stat-label">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="about-divider" />

          <p className="about-section-label">Unsere Mission</p>
          <div className="about-cards">
            <div className="about-card">
              <h3>Privatsphäre zuerst</h3>
              <p>Wir glauben an die Bedeutung der Privatsphäre. Wieland AI ist darauf ausgelegt, deine Daten sicher und verschlüsselt zu speichern.</p>
            </div>
            <div className="about-card">
              <h3>Moderne Technologie</h3>
              <p>Wieland wird von Qwen3-VL unterstützt und bietet eine erstklassige KI-Erlebnis.</p>
            </div>

          </div>

          <div className="about-divider" />

          <p className="about-section-label">Technologie-Stack</p>
          <div className="about-stack">
            {[
              { label: 'Frontend', tags: ['React', 'Vite', 'CSS'] },
              { label: 'Backend', tags: ['Node.js', 'Express'] },
              { label: 'Datenbank', tags: ['PostgreSQL'] },
              { label: 'KI-Engine', tags: ['Ollama', 'Qwen3-VL'] },
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