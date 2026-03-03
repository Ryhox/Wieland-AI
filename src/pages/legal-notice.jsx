import '../styles/header.css';
import '../styles/main.css';
import Header from '../components/header';
import Footer from '../components/footer';

function LegalNotice({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
<Header noSidebar />

      <main className="page-content">
        <div className="page-container">

            <h1>Legal Notice</h1>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default LegalNotice;