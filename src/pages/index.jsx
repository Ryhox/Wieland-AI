import { useState, useRef } from "react";
import Starfield from "../components/Starfield";
import Scene3D from "../components/Scene3D";
import ChatInterface from "../components/ChatInterface";
import LoadingAnimation from "../components/LoadingAnimation";
import Header from "../components/Header";
import "../styles/HomePage.css";
import { useAuth } from "../context/AuthContext";

// Hauptflow auf einer Seite - State zentral damit alle Child Components ihn sehen
function Home({ isSidebarOpen, onSidebarToggle }) {
  // 3D Scene rendering finished?
  const [is3DReady, setIs3DReady] = useState(false);
  // Messages in Chat vorhanden?
  const [hasMessages, setHasMessages] = useState(false);
  const { user } = useAuth();
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
        inputOffset={hasMessages ? 50 : 425} // Je nachdem ob Messages vorhanden
        onNewChatRef={(fn) => {
          newChatRef.current = fn; // Child gibt New-Chat Funktion zurück
        }}
      />
    </div>
  );
}

export default Home;
