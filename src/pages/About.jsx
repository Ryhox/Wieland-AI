import '../styles/Header.css';
import '../styles/main.css';
import Header from '../components/header';
import Footer from '../components/footer';

function About({ isSidebarOpen }) {
  return (
    <div className={`page-wrapper ${isSidebarOpen ? 'sidebar-open' : ''}`}>
<Header noSidebar />

      <main className="page-content">
        <div className="page-container">

            <h1>Über</h1>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default About;