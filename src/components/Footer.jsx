import '../styles/Footer.css';
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <span className="footer-logo">Wieland AI</span>
        <div className="footer-links">
          <a href="/legal-notice">Impressum</a>
          <a href="/privacy-policy">Datenschutz</a>
          <a href="/terms-of-service">Nutzungsbedingungen</a>
        </div>
        <span className="footer-copy">© {new Date().getFullYear()} Wieland. All rights reserved.</span>
      </div>
    </footer>
  );
}

export default Footer;
