import { useState } from 'react';
import '../styles/Contact.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

function Contact({ isSidebarOpen, onSidebarToggle }) {
  const { user } = useAuth();
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setSubmitted(true);
        setFormData({ name: '', email: '', subject: '', message: '' });
        setTimeout(() => setSubmitted(false), 5000);
      }
    } catch (err) {
      console.error('Fehler beim Senden:', err);
    }
  };

  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content">
        <div className="page-container contact-container">

          <div className="contact-hero">
            <span className="contact-eyebrow">Kontakt</span>
            <h1 className="contact-h1">Lass uns<br /><span>zusammenarbeiten.</span></h1>
            <p className="contact-lead">
              Hast du Fragen, Vorschläge oder möchtest du mit uns in Kontakt treten? Schreib uns eine Nachricht – das Team hilft gern weiter.
            </p>
          </div>

          <div className="contact-divider" />

          <div className="contact-content">
            <div className="contact-form-wrapper">
              <h2 className="contact-form-title">Schreib uns eine Nachricht</h2>
              {submitted && <div className="contact-success">Nachricht erfolgreich gesendet!</div>}
              <form onSubmit={handleSubmit} className="contact-form">
                <div className="contact-form-row">
                  <div className="contact-form-group">
                    <label htmlFor="name">Name</label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      placeholder="Dein Name"
                      required
                    />
                  </div>

                  <div className="contact-form-group">
                    <label htmlFor="email">E-Mail</label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="deine@email.de"
                      required
                    />
                  </div>
                </div>

                <div className="contact-form-group">
                  <label htmlFor="subject">Betreff</label>
                  <input
                    type="text"
                    id="subject"
                    name="subject"
                    value={formData.subject}
                    onChange={handleChange}
                    placeholder="Worum geht es?"
                    required
                  />
                </div>

                <div className="contact-form-group">
                  <label htmlFor="message">Nachricht</label>
                  <textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Deine Nachricht..."
                    rows="7"
                    required
                  />
                </div>

                <button type="submit" className="contact-submit-btn">Nachricht senden</button>
              </form>
            </div>
          </div>

          <div className="contact-divider" />

          <div className="contact-info-section">
            <h2 className="contact-info-title">Kontaktieren Sie uns</h2>
            <div className="contact-info-grid">
              <div className="contact-info-card">
                <span className="contact-info-label">📍 Standort</span>
                <p>Wieland Headquarters<br />Deutschland</p>
              </div>
              <div className="contact-info-card">
                <span className="contact-info-label">📧 E-Mail</span>
                <p><a href="mailto:info@wieland.local">info@wieland.local</a></p>
              </div>
              <div className="contact-info-card">
                <span className="contact-info-label">📞 Support</span>
                <p>Kontakt per Formular – <br />wir melden uns schnell!</p>
              </div>
            </div>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Contact;
