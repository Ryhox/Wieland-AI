import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useState } from "react";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import CookieBanner from "./components/CookieBanner.jsx";

import Index from "./pages/index";
import ChatPage from "./pages/ChatPage";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Profile from "./pages/Profile";
import FAQ from "./pages/faq";
import Changelogs from "./pages/Changelogs";
import Download from "./pages/Download";
import LegalNotice from "./pages/legal-notice";
import PrivacyPolicy from "./pages/privacy-policy";
import TermsOfService from "./pages/terms-of-service";
import Pricing from "./pages/Pricing";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/404.jsx";

function AppContent() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();

  return (
    <>
      <CookieBanner />
      <Routes>
        <Route path="/" element={<Index isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/chat" element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        } />
        <Route path="/chat/:chatId" element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        } />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute requiredPlan="Admin">
              <Dashboard isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />
            </ProtectedRoute>
          }
        />
        <Route path="/about" element={<About isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/contact" element={<Contact isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/profile" element={
          <ProtectedRoute>
            <Profile isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />
          </ProtectedRoute>
        } />
        <Route path="/faq" element={<FAQ isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/changelogs" element={<Changelogs isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/download" element={<Download isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/legal-notice" element={<LegalNotice isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/terms-of-service" element={<TermsOfService isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />
        <Route path="/pricing" element={<Pricing isSidebarOpen={isSidebarOpen} onSidebarToggle={setIsSidebarOpen} />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;