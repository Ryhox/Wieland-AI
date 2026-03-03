import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Index from "./pages/index";
import ChatPage from "./pages/ChatPage";
import About from "./pages/About";
import FAQ from "./pages/faq";
import Changelogs from "./pages/Changelogs";
import Download from "./pages/Download";
import LegalNotice from "./pages/legal-notice";
import PrivacyPolicy from "./pages/privacy-policy";
import TermsOfService from "./pages/terms-of-service";
import NotFound from "./pages/404.jsx";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/chat/:chatId" element={<ChatPage />} />
        <Route path="/about" element={<About />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/changelogs" element={<Changelogs />} />
        <Route path="/download" element={<Download />} />
        <Route path="/legal-notice" element={<LegalNotice />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;