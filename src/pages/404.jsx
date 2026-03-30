import "../styles/Header.css";
import "../styles/main.css";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Footer from "../components/Footer";

function NotFound({ isSidebarOpen }) {
  const { t } = useTranslation();
  return (
    <div className={`page-wrapper ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <Header noSidebar />

      <main className="page-content">
        <div className="page-container">
          <h1>{t("notFound.title")}</h1>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default NotFound;
