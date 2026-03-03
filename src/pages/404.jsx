import '../styles/Header.css';
import '../styles/main.css';
import Header from '../components/header';
import Footer from '../components/footer';

function NotFound({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
<Header noSidebar />

      <main className="page-content">
        <div className="page-container">

            <h1>404 - Seite nicht gefunden</h1>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default NotFound;