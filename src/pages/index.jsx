import { useState, useRef } from 'react';
import Starfield from '../components/Starfield';
import Scene3D from '../components/Scene3D';
import ChatInterface from '../components/ChatInterface';
import LoadingAnimation from '../components/LoadingAnimation';
import Header from '../components/Header';
import '../styles/HomePage.css';
import { useAuth } from '../context/AuthContext';

function Home() {
  const [is3DReady, setIs3DReady] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);  const isInitialLoadRef = useRef(true);
  const noSidebar = !user;

  const newChatRef = useRef(null); 

  const showLoading = isInitialLoadRef.current && !is3DReady;

  return (
    <div className={`home-container ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Header 
        isSidebarOpen={sidebarOpen}
        noSidebar={noSidebar}
        onNewChat={() => newChatRef.current?.()}
      />
      <LoadingAnimation isVisible={showLoading} />

  <Starfield />
      

      
      <Scene3D hasMessages={hasMessages} onReady={() => { setIs3DReady(true); isInitialLoadRef.current = false; }} />
<ChatInterface
  onMessagesChange={setHasMessages}
  sidebarOpen={sidebarOpen}
  onSidebarChange={setSidebarOpen}
  inputOffset={hasMessages ? 50 : 425}
  onNewChatRef={(fn) => { newChatRef.current = fn; }}
/>
    </div>
  );
}

export default Home;