import '../styles/header.css';

function Header({ isSidebarOpen, noSidebar, onNewChat }) {


  return (
    <header className={`header ${noSidebar ? 'no-sidebar' : ''} ${!noSidebar && isSidebarOpen ? 'sidebar-open' : ''}`}>

<a href="/" className="header-logo" onClick={noSidebar ? undefined : (e) => { e.preventDefault(); onNewChat(); }}>
  <span className="header-logo-name">Wieland</span>
</a>

      <nav className="header-nav">
        <a href="/about">Über</a>
        <a href="/faq">FAQ</a>
        <a href="/changelogs">Changelogs</a>
      </nav>
      <div className="galaxy-button">
        <a href="/download" className="space-button">
          <span className="backdrop"></span>
          <span className="galaxy"></span>
          <label className="text">Download Extension</label>
        </a>
        <div className="bodydrop"></div>
      </div>
    </header>
  );
}

export default Header;