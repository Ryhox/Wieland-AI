import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Starfield from '../components/Starfield';
import Scene3D from '../components/Scene3D';
import ChatInterface from '../components/ChatInterface';
import LoadingAnimation from '../components/LoadingAnimation';
import Header from '../components/Header';
import '../styles/HomePage.css';

function ChatPage() {
  const { chatId } = useParams();
  const [hasMessages, setHasMessages] = useState(true);
  const [is3DReady, setIs3DReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [actualFilename, setActualFilename] = useState(null);
  const isInitialLoadRef = useRef(true);
  const newChatRef = useRef(null);
  useEffect(() => {
    if (chatId) {
      const findChatFile = async () => {
        try {
          const response = await fetch('/api/history');
          if (response.ok) {
            const chats = await response.json();
            const matchingChat = chats.find(chat =>
              chat.filename.includes(chatId)
            );
            if (matchingChat) {
              setActualFilename(matchingChat.filename);
            } else {
              console.log('No chat found with timestamp:', chatId);
              setActualFilename(null);
            }
          }
        } catch (error) {
          console.error('Error finding chat file:', error);
          setActualFilename(null);
        }
      };

      findChatFile();
    } else {
      setActualFilename(null);
    }
  }, [chatId]);

  const showLoading = isInitialLoadRef.current && !is3DReady;

  return (
    <div className="home-container">
      <LoadingAnimation isVisible={showLoading} />
      <Header
        isSidebarOpen={sidebarOpen}
        onHamburgerClick={() => setSidebarOpen(v => !v)}
        onNewChat={() => newChatRef.current?.()}
      />
      <Starfield />
      <Scene3D hasMessages={hasMessages} onReady={() => { setIs3DReady(true); isInitialLoadRef.current = false; }} />
      <ChatInterface
        onMessagesChange={setHasMessages}
        chatId={actualFilename}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
        inputOffset={hasMessages ? 50 : 425}
        onNewChatRef={(fn) => { newChatRef.current = fn; }}

      />
    </div>
  );
}

export default ChatPage;