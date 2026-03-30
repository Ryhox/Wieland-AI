import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import "../styles/Header.css";
import AuthModal from "./AuthModal";
import ReactCountryFlag from "react-country-flag";
import { DEFAULT_LANG, stripLangPrefix, withLang } from "../utils/i18nRouting";

const LANGUAGES = [
  { code: "de", label: "Deutsch", flagCode: "DE" },
  { code: "en", label: "English", flagCode: "GB" },
  { code: "it", label: "Italiano", flagCode: "IT" },
];

function LanguageButton() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const selected =
    LANGUAGES.find((lang) => lang.code === i18n.language) || LANGUAGES[0];

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
        <ReactCountryFlag
          countryCode={selected.flagCode}
          svg
          style={{ width: "1.2em", height: "1.2em", marginRight: "0.3em" }}
          title={t(`languages.${selected.code}`)}
        />
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
              <ReactCountryFlag
                countryCode={lang.flagCode}
                svg
                style={{ width: "1.2em", height: "1em", marginRight: "0.5em" }}
                title={t(`languages.${lang.code}`)}
              />
              <span>{t(`languages.${lang.code}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ isSidebarOpen, onNewChat, onSidebarToggle }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const lang = i18n.language || DEFAULT_LANG;
  const localPath = (path) => withLang(path, lang);

  let headerClass = "header";
  if (!user) {
    headerClass += " no-sidebar";
  } else if (isSidebarOpen) {
    headerClass += " sidebar-open";
  }

  const handleLogoClick = (e) => {
    e.preventDefault();
    if (!user) {
      navigate(localPath("/"));
    } else {
      navigate(localPath("/"));
      onNewChat?.();
    }
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
              <path
                className="lineTop line"
                strokeLinecap="round"
                strokeWidth="4"
                stroke="white"
                d="M6 11L44 11"
              />
              <path
                className="lineMid line"
                strokeLinecap="round"
                strokeWidth="4"
                stroke="white"
                d="M6 24H43"
              />
              <path
                className="lineBottom line"
                strokeLinecap="round"
                strokeWidth="4"
                stroke="white"
                d="M6 37H43"
              />
            </svg>
          </button>
        )}

        <a
          href={localPath("/")}
          className="header-logo"
          onClick={handleLogoClick}
        >
          <span className="header-logo-name">Wieland</span>
        </a>

        <LanguageButton />

        <nav className="header-nav">
          <a href={localPath("/about")}>{t("header.navAbout")}</a>
          <a href={localPath("/faq")}>{t("header.navFaq")}</a>
          <a href={localPath("/changelogs")}>{t("header.navChangelogs")}</a>
          <a href={localPath("/pricing")}>{t("header.navPricing")}</a>
        </nav>

        <button
          className="header-mobile-menu-btn"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label={t("header.menuOpen")}
          title={t("header.menu")}
        >
          <span
            className={`mobile-menu-line ${mobileMenuOpen ? "open" : ""}`}
          />
          <span
            className={`mobile-menu-line ${mobileMenuOpen ? "open" : ""}`}
          />
          <span
            className={`mobile-menu-line ${mobileMenuOpen ? "open" : ""}`}
          />
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
            <button
              className="header-login-btn"
              onClick={() => setAuthModalOpen(true)}
            >
              {t("header.login")}
            </button>
          )}
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="header-mobile-overlay" onClick={closeMobileMenu}>
          <aside
            className="header-mobile-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="header-mobile-top">
              <a
                href={localPath("/")}
                className="header-logo-mobile"
                onClick={closeMobileMenu}
              >
                <span>Wieland</span>
              </a>
              <button
                className="header-mobile-close"
                onClick={closeMobileMenu}
                aria-label={t("header.menuClose")}
              >
                ✕
              </button>
            </header>

            <nav className="header-mobile-nav">
              <a href={localPath("/about")} onClick={closeMobileMenu}>
                {t("header.navAbout")}
              </a>
              <a href={localPath("/faq")} onClick={closeMobileMenu}>
                {t("header.navFaq")}
              </a>
              <a href={localPath("/changelogs")} onClick={closeMobileMenu}>
                {t("header.navChangelogs")}
              </a>
              <a href={localPath("/pricing")} onClick={closeMobileMenu}>
                {t("header.navPricing")}
              </a>
              <a href={localPath("/download")} onClick={closeMobileMenu}>
                Download
              </a>
            </nav>

            <div className="header-mobile-bottom">
              {!user && (
                <button
                  className="header-mobile-login-btn"
                  onClick={() => {
                    closeMobileMenu();
                    setAuthModalOpen(true);
                  }}
                >
                  {t("header.login")}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
    </>
  );
}

export default Header;
