import { useState, useEffect } from 'react';

import '../styles/About.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

function About({ isSidebarOpen }) {
    const [stats, setStats] = useState({ total_users: null, total_chats: null, total_messages: null });

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {});
  }, []);

  const fmt = (n) => n === null ? '…' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header noSidebar />

      <main className="page-content">
        <div className="page-container about-container">

          <div className="about-hero">
            <span className="about-eyebrow">Über uns</span>
            <h1 className="about-h1">Intelligenz,<br /><span>lokal gedacht.</span></h1>
            <p className="about-lead">
              Wieland AI ist ein offline-fähiger KI-Assistent, der direkt auf deinem Gerät läuft —
              ohne Cloud, ohne Datenweitergabe, ohne Kompromisse.
            </p>
          </div>

          <div className="about-stats">
            {[
              { num: '100%', label: 'Offline-fähig' },
              { num: 'OpenSource',  label: 'GitHub' },
              { num: 'MIT',  label: 'Lizenz' },
              { num: fmt(stats.total_users),    label: 'Nutzer' },
              { num: fmt(stats.total_chats),    label: 'Gespräche' },
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
              <p>Deine Gespräche gehören dir. Wieland AI verarbeitet alle Anfragen lokal über Ollama — kein einziger Token verlässt dein Gerät, solange du offline bleibst.</p>
            </div>
            <div className="about-card">
              <h3>Moderne Technologie</h3>
              <p>Gebaut mit React, Vite, Express und PostgreSQL. Modelle wie Qwen3-VL laufen direkt auf deiner Hardware und liefern erstklassige Antworten.</p>
            </div>

          </div>

          <div className="about-divider" />

          <p className="about-section-label">Technologie-Stack</p>
          <div className="about-stack">
            {[
              { label: 'Frontend',   tags: ['React', 'Vite', 'CSS'] },
              { label: 'Backend',    tags: ['Node.js', 'Express'] },
              { label: 'Datenbank',  tags: ['PostgreSQL'] },
              { label: 'KI-Engine',  tags: ['Ollama', 'Qwen3-VL'] },
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