import { useState, useRef } from "react";
import Starfield from "../components/Starfield";
import Scene3D from "../components/Scene3D";
import ChatInterface from "../components/ChatInterface";
import LoadingAnimation from "../components/LoadingAnimation";
import Header from "../components/Header";
import LegalModal from "../components/LegalModal";
import "../styles/HomePage.css";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";

// Hauptflow auf einer Seite - State zentral damit alle Child Components ihn sehen
function Home({ isSidebarOpen, onSidebarToggle }) {
  // 3D Scene rendering finished?
  const [is3DReady, setIs3DReady] = useState(false);
  // Messages in Chat vorhanden?
  const [hasMessages, setHasMessages] = useState(false);
  // Legal Modal state
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);
  const { user } = useAuth();
  const { t } = useTranslation();
  // Nur beim First Mount Loading zeigen bis 3D ready ist
  const isInitialLoadRef = useRef(true);

  // New Chat funktion wird von Child über ref gesettet
  const newChatRef = useRef(null);

  // Loading screen nur am Anfang wenn 3D noch nicht ready
  const showLoading = isInitialLoadRef.current && !is3DReady;

  return (
    <div className={`home-container ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <Header
        isSidebarOpen={isSidebarOpen}
        onSidebarToggle={onSidebarToggle}
        onNewChat={() => newChatRef.current?.()} // Callback zu Child
      />
      <LoadingAnimation isVisible={showLoading} />

      <Starfield />
      <div className="home-ambient-glow" />

      {/* 3D Szenerie */}
      <Scene3D
        hasMessages={hasMessages}
        onReady={() => {
          setIs3DReady(true);
          isInitialLoadRef.current = false;
        }}
      />
      {/* Chat Area */}
      <ChatInterface
        onMessagesChange={setHasMessages}
        sidebarOpen={isSidebarOpen}
        onSidebarChange={onSidebarToggle}
        pageVariant="home"
        inputOffset={hasMessages ? 50 : 425} // Je nachdem ob Messages vorhanden
        onNewChatRef={(fn) => {
          newChatRef.current = fn; // Child gibt New-Chat Funktion zurück
        }}
      />

      {/* Legal Button - nur wenn nicht eingeloggt */}
      {!user && (
        <button
          className="home-legal-button"
          onClick={() => setIsLegalModalOpen(true)}
          title={t("legal.noticeEyebrow")}
        >
          <svg width="100%" viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg">
            <path d="M250 30 L390 30 L450 90 L450 290 L250 290 Z" fill="none" stroke="white" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round"/>
            <path d="M390 30 L390 90 L450 90" fill="none" stroke="white" strokeWidth="6" strokeLinejoin="round"/>
            <line x1="282" y1="160" x2="418" y2="160" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <line x1="282" y1="195" x2="418" y2="195" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <line x1="282" y1="230" x2="355" y2="230" stroke="white" strokeWidth="5" strokeLinecap="round"/>
          </svg>
          <span className="home-legal-label">{t("legal.noticeEyebrow")}</span>
        </button>
      )}

      {/* Legal Modal */}
      <LegalModal
        isOpen={isLegalModalOpen}
        onClose={() => setIsLegalModalOpen(false)}
      />
    </div>
  );
}

export default Home;
