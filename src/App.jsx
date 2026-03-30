import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import CookieBanner from "./components/CookieBanner.jsx";
import {
  DEFAULT_LANG,
  getPreferredLang,
  isSupportedLang,
  stripLangPrefix,
  withLang,
} from "./utils/i18nRouting";

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

function AppRoutes() {
  const { lang } = useParams();
  const location = useLocation();
  const { i18n } = useTranslation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const activeLang = isSupportedLang(lang) ? lang : DEFAULT_LANG;

  if (location.pathname === `/${activeLang}`) {
    return <Navigate to={`/${activeLang}/`} replace />;
  }

  useEffect(() => {
    if (i18n.language !== activeLang) {
      i18n.changeLanguage(activeLang);
    }
  }, [activeLang, i18n]);

  if (!isSupportedLang(lang)) {
    return (
      <Navigate
        to={withLang(stripLangPrefix(location.pathname), DEFAULT_LANG)}
        replace
      />
    );
  }

  return (
    <>
      <CookieBanner />
      <Routes>
        <Route
          path="/"
          element={
            <Index
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/:chatId"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute requiredPlan="Admin">
              <Dashboard
                isSidebarOpen={isSidebarOpen}
                onSidebarToggle={setIsSidebarOpen}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/about"
          element={
            <About
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/contact"
          element={
            <Contact
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile
                isSidebarOpen={isSidebarOpen}
                onSidebarToggle={setIsSidebarOpen}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/faq"
          element={
            <FAQ
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/changelogs"
          element={
            <Changelogs
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/download"
          element={
            <Download
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/legal-notice"
          element={
            <LegalNotice
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/privacy-policy"
          element={
            <PrivacyPolicy
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/terms-of-service"
          element={
            <TermsOfService
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />
        <Route
          path="/pricing"
          element={
            <Pricing
              isSidebarOpen={isSidebarOpen}
              onSidebarToggle={setIsSidebarOpen}
            />
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

function LegacyRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={withLang(stripLangPrefix(location.pathname), DEFAULT_LANG)}
      replace
    />
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route
            path="/"
            element={
              <Navigate
                to={withLang("/", getPreferredLang(window.location.pathname))}
                replace
              />
            }
          />
          <Route path="/:lang/*" element={<AppRoutes />} />
          <Route path="*" element={<LegacyRedirect />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
