import { useState, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import Starfield from "../components/Starfield";
import Scene3D from "../components/Scene3D";
import ChatInterface from "../components/ChatInterface";
import LoadingAnimation from "../components/LoadingAnimation";
import Header from "../components/Header";
import { useAuth } from "../context/AuthContext";
import "../styles/HomePage.css";

// Chat-Seite mit geteiltem Layout wie Homepage - hier wird bestimmter Chat geladen
function ChatPage() {
  const { chatId } = useParams(); // URL Param: /chat/:chatId
  const { authFetch } = useAuth();
  const [hasMessages, setHasMessages] = useState(true);
  const [is3DReady, setIs3DReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [actualFilename, setActualFilename] = useState(null); // Echte Datei aus API response
  const isInitialLoadRef = useRef(true);
  const newChatRef = useRef(null);
  const loadChatRef = useRef(null);

  // Chat Datei von API holen wenn chatId sich ändert
  useEffect(() => {
    if (chatId) {
      const findChatFile = async () => {
        try {
          const response = await authFetch("/api/history");
          if (response.ok) {
            const chats = await response.json();
            // Chat ID von URL mit Dateiname matchen - UUID oder chat_ID.json Format
            const matchingChat = chats.find(
              (chat) =>
                chat.filename.includes(chatId) ||
                chat.filename === `chat_${chatId}.json`,
            );
            if (matchingChat) {
              setActualFilename(matchingChat.filename);
            } else {
              console.log("No chat found with UUID:", chatId);
              setActualFilename(null);
            }
          }
        } catch (error) {
          console.error("Error finding chat file:", error);
          setActualFilename(null);
        }
      };

      findChatFile();
    } else {
      setActualFilename(null);
    }
  }, [chatId, authFetch]);

  // Wenn Dateiname gefunden > Chat in Interface laden
  useEffect(() => {
    if (actualFilename && loadChatRef.current) {
      loadChatRef.current(actualFilename);
    }
  }, [actualFilename]);

  // Loading Screen nur am Anfang
  const showLoading = isInitialLoadRef.current && !is3DReady;

  return (
    <div className="home-container">
      <LoadingAnimation isVisible={showLoading} />
      <Header
        isSidebarOpen={sidebarOpen}
        onSidebarToggle={setSidebarOpen}
        onNewChat={() => newChatRef.current?.()} // New Chat Button
      />
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
      {/* Chat Area - lädt genannten Chat wenn actualFilename da ist */}
      <ChatInterface
        onMessagesChange={setHasMessages}
        chatId={actualFilename}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
        pageVariant="chat"
        inputOffset={hasMessages ? 50 : 425}
        onNewChatRef={(fn) => {
          newChatRef.current = fn;
        }}
        onLoadChatRef={(fn) => {
          loadChatRef.current = fn;
        }}
      />
    </div>
  );
}

export default ChatPage;
