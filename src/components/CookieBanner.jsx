import { useState, useEffect } from 'react';
import '../styles/CookieBanner.css';

export default function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const cookieConsent = localStorage.getItem('wieland_cookie_consent');
    if (!cookieConsent) {
      setShow(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('wieland_cookie_consent', 'accepted');
    document.cookie = 'wieland_cookie_consent=accepted; path=/; max-age=31536000';
    setShow(false);
  };

  const handleDecline = () => {
    localStorage.setItem('wieland_cookie_consent', 'declined');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="cookie-banner">
      <div className="cookie-banner-content">
        <div className="cookie-banner-text">
          <h3>🍪 Cookie-Einwilligung</h3>
          <p>
            Wir verwenden Cookies und lokale Speicherung, um dich angemeldet zu halten und deine Sitzung zu speichern.
            Deine Daten verlassen dein Gerät nicht.
          </p>
        </div>
        <div className="cookie-banner-buttons">
          <button className="cookie-btn cookie-btn-accept" onClick={handleAccept}>
            Akzeptieren
          </button>
          <button className="cookie-btn cookie-btn-decline" onClick={handleDecline}>
            Ablehnen
          </button>
        </div>
      </div>
    </div>
  );
}
