import '../styles/Header.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

function TermsOfService({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header noSidebar />

      <main className="page-content">
        <div className="page-container">

          <h1>Terms of Service</h1>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default TermsOfService;