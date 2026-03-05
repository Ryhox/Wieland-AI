import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/Header.css';
import AuthModal from './AuthModal';

function Header({ isSidebarOpen, noSidebar, onNewChat }) {
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

let headerClass = "header";
if (noSidebar) {
  headerClass += " no-sidebar";
} else if (isSidebarOpen) {
  headerClass += " sidebar-open";
}

  return (
    <>
      <header className={headerClass}>
          <a href="/" className="header-logo" onClick={noSidebar ? undefined : (e) => { e.preventDefault(); onNewChat?.(); }}>
          <span className="header-logo-name">Wieland</span>
        </a>

        <nav className="header-nav">
          
          <a href="/about">Über</a>
          <a href="/faq">FAQ</a>
          <a href="/changelogs">Changelogs</a>
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
            <button
              className="header-login-btn"
              onClick={() => setAuthModalOpen(true)}
            >
              Anmelden
            </button>
          )}
        </div>
      </header>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
    </>
  );
}

export default Header;