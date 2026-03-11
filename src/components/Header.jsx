import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/Header.css';
import AuthModal from './AuthModal';
import ReactCountryFlag from 'react-country-flag';

const LANGUAGES = [
  { code: 'de', label: 'Deutsch', flagCode: 'DE' },
  { code: 'en', label: 'English', flagCode: 'GB' },
  { code: 'it', label: 'Italiano', flagCode: 'IT' },
];

function LanguageButton() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(LANGUAGES[0]);

  return (
    <div
      className="lang-btn-wrapper"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button className="lang-btn" onClick={() => setOpen((o) => !o)}>
        <ReactCountryFlag
          countryCode={selected.flagCode}
          svg
          style={{ width: '1.2em', height: '1.2em', marginRight: '0.3em' }}
          title={selected.label}
        />
        <span className="lang-code">{selected.code.toUpperCase()}</span>
        <span className={`lang-chevron ${open ? 'open' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 3.5L5 6.5L8 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="lang-dropdown">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              className={`lang-option ${lang.code === selected.code ? 'active' : ''}`}
              onClick={() => {
                setSelected(lang);
                setOpen(false);
              }}
            >
              <ReactCountryFlag
                countryCode={lang.flagCode}
                svg
                style={{ width: '1.2em', height: '1em', marginRight: '0.5em' }}
                title={lang.label}
              />
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ isSidebarOpen, noSidebar, onNewChat }) {
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  let headerClass = 'header';
  if (noSidebar) {
    headerClass += ' no-sidebar';
  } else if (isSidebarOpen) {
    headerClass += ' sidebar-open';
  }

  return (
    <>
      <header className={headerClass}>
        <a
          href="/"
          className="header-logo"
          onClick={
            noSidebar ? undefined : (e) => {
              e.preventDefault();
              onNewChat?.();
            }
          }
        >
          <span className="header-logo-name">Wieland</span>
        </a>

        <LanguageButton />

        <nav className="header-nav">
          <a href="/about">Über</a>
          <a href="/faq">FAQ</a>
          <a href="/changelogs">Changelogs</a>
          <a href="/pricing">Pricing</a>
        </nav>

        <div className="header-right">
          <div className="galaxy-button">
            <a href="/download" className="space-button">
              <span className="backdrop"></span>
              <span className="galaxy"></span>
              <label className="text">Download Extension</label>
            </a>
            <div className="bodydrop"></div>
          </div>

          {!user && (
            <button className="header-login-btn" onClick={() => setAuthModalOpen(true)}>
              Anmelden
            </button>
          )}
        </div>
      </header>

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </>
  );
}

export default Header;