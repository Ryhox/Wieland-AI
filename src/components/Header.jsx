import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import "../styles/Header.css";
import AuthModal from "./AuthModal";
import { DEFAULT_LANG, stripLangPrefix, withLang } from "../utils/i18nRouting";

// ---------- Offline Flags as React components ----------
const DEFlag = ({ size = 24 }) => (
  <svg width={size} height={(size * 2) / 3} viewBox="0 0 3 2" xmlns="http://www.w3.org/2000/svg">
    <rect width="3" height="0.6667" y="0" fill="#000"/>
    <rect width="3" height="0.6667" y="0.6667" fill="#DD0000"/>
    <rect width="3" height="0.6667" y="1.3333" fill="#FFCC00"/>
  </svg>
);

const ITFlag = ({ size = 24 }) => (
  <svg width={size} height={(size * 2) / 3} viewBox="0 0 3 2" xmlns="http://www.w3.org/2000/svg">
    <rect width="1" height="2" x="0" fill="#009246"/>
    <rect width="1" height="2" x="1" fill="#FFF"/>
    <rect width="1" height="2" x="2" fill="#CE2B37"/>
  </svg>
);

const GBFlag = ({ size = 24 }) => (
  <svg width={size} height={(size * 2) / 3} viewBox="0 0 60 30" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="30" fill="#012169"/>
    <path d="M0 0 L60 30 M60 0 L0 30" stroke="#fff" strokeWidth="6"/>
    <path d="M0 0 L60 30 M60 0 L0 30" stroke="#C8102E" strokeWidth="4"/>
    <rect x="25" width="10" height="30" fill="#fff"/>
    <rect y="10" width="60" height="10" fill="#fff"/>
    <rect x="27" width="6" height="30" fill="#C8102E"/>
    <rect y="12" width="60" height="6" fill="#C8102E"/>
  </svg>
);

// ---------- LanguageButton ----------
const LANGUAGES = [
  { code: "de", label: "Deutsch", Flag: DEFlag },
  { code: "en", label: "English", Flag: GBFlag },
  { code: "it", label: "Italiano", Flag: ITFlag },
];

function LanguageButton() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const selected = LANGUAGES.find((lang) => lang.code === i18n.language) || LANGUAGES[0];

  const handleLanguageSelect = (lang) => {
    i18n.changeLanguage(lang.code);
    const currentPath = stripLangPrefix(location.pathname);
    navigate(withLang(currentPath, lang.code));
    setOpen(false);
  };

  return (
    <div
      className="lang-btn-wrapper"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button className="lang-btn" onClick={() => setOpen((o) => !o)}>
        <span style={{ width: "1.2em", height: "1em", marginRight: "0.3em", display: "inline-block" }}>
          <selected.Flag size={16} />
        </span>
        <span className="lang-code">{selected.code.toUpperCase()}</span>
        <span className={`lang-chevron ${open ? "open" : ""}`}>
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
              className={`lang-option ${lang.code === selected.code ? "active" : ""}`}
              onClick={() => handleLanguageSelect(lang)}
            >
              <span style={{ width: "1.2em", height: "1em", marginRight: "0.5em", display: "inline-block" }}>
                <lang.Flag size={16} />
              </span>
              <span>{t(`languages.${lang.code}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Header ----------
function Header({ isSidebarOpen, onNewChat, onSidebarToggle }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const lang = i18n.language || DEFAULT_LANG;
  const localPath = (path) => withLang(path, lang);

  let headerClass = "header";
  if (!user) headerClass += " no-sidebar";
  else if (isSidebarOpen) headerClass += " sidebar-open";

  const handleLogoClick = (e) => {
    e.preventDefault();
    navigate(localPath("/"));
    onNewChat?.();
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <header className={headerClass}>
        {user && (
          <button
            className={`header-sidebar-toggle ${isSidebarOpen ? "sidebar-open" : ""}`}
            onClick={() => onSidebarToggle?.(!isSidebarOpen)}
            aria-label={t("header.toggleSidebar")}
            title={t("header.toggleSidebar")}
          >
            <svg fill="none" viewBox="0 0 50 50" height="28" width="28">
              <path className="lineTop line" strokeLinecap="round" strokeWidth="4" stroke="white" d="M6 11L44 11"/>
              <path className="lineMid line" strokeLinecap="round" strokeWidth="4" stroke="white" d="M6 24H43"/>
              <path className="lineBottom line" strokeLinecap="round" strokeWidth="4" stroke="white" d="M6 37H43"/>
            </svg>
          </button>
        )}

        <a href={localPath("/")} className="header-logo" onClick={handleLogoClick}>
          <span className="header-logo-name">Wieland</span>
        </a>

        <LanguageButton />

        <nav className="header-nav">
          <a href={localPath("/about")}>{t("header.navAbout")}</a>
          <a href={localPath("/faq")}>{t("header.navFaq")}</a>
          <a href={localPath("/changelogs")}>{t("header.navChangelogs")}</a>
          <a href={localPath("/pricing")}>{t("header.navPricing")}</a>
          <a href={localPath("/conclusion")}>{t("header.navConclusion")}</a>
        </nav>

        <button
          className="header-mobile-menu-btn"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label={t("header.menuOpen")}
          title={t("header.menu")}
        >
          <span className={`mobile-menu-line ${mobileMenuOpen ? "open" : ""}`}/>
          <span className={`mobile-menu-line ${mobileMenuOpen ? "open" : ""}`}/>
          <span className={`mobile-menu-line ${mobileMenuOpen ? "open" : ""}`}/>
        </button>

        <div className="header-right">
          <div className="galaxy-button">
            <a href={localPath("/download")} className="space-button">
              <span className="backdrop"></span>
              <span className="galaxy"></span>
              <label className="text">{t("header.downloadExtension")}</label>
            </a>
            <div className="bodydrop"></div>
          </div>

          {!user && (
            <button className="header-login-btn" onClick={() => setAuthModalOpen(true)}>
              {t("header.login")}
            </button>
          )}
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="header-mobile-overlay" onClick={closeMobileMenu}>
          <aside className="header-mobile-panel" onClick={(e) => e.stopPropagation()}>
            <header className="header-mobile-top">
              <a href={localPath("/")} className="header-logo-mobile" onClick={closeMobileMenu}>
                <span>Wieland</span>
              </a>
              <button className="header-mobile-close" onClick={closeMobileMenu} aria-label={t("header.menuClose")}>
                {"\u00D7"}
              </button>
            </header>

            <nav className="header-mobile-nav">
              <a href={localPath("/about")} onClick={closeMobileMenu}>{t("header.navAbout")}</a>
              <a href={localPath("/faq")} onClick={closeMobileMenu}>{t("header.navFaq")}</a>
              <a href={localPath("/changelogs")} onClick={closeMobileMenu}>{t("header.navChangelogs")}</a>
              <a href={localPath("/conclusion")} onClick={closeMobileMenu}>{t("header.navConclusion")}</a>
              <a href={localPath("/pricing")} onClick={closeMobileMenu}>{t("header.navPricing")}</a>
              <a href={localPath("/download")} onClick={closeMobileMenu}>Download</a>
            </nav>

            <div className="header-mobile-bottom">
              {!user && (
                <button className="header-mobile-login-btn" onClick={() => { closeMobileMenu(); setAuthModalOpen(true); }}>
                  {t("header.login")}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </>
  );
}

export default Header;