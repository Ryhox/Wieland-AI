import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Sidebar.css';

export default function Sidebar({ onNewChat, onDeleteChat, onLoadChat, currentChatId, isOpen, onOpenChange }) {
  const { user, logout, authFetch } = useAuth();
  const navigate = useNavigate();
  const [chats, setChats] = useState([]);
  const sidebarRef = useRef(null);

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : '?';

  useEffect(() => {
    loadChats();
    const interval = setInterval(loadChats, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = () => loadChats();
    window.addEventListener('chatHistoryUpdated', handler);
    return () => window.removeEventListener('chatHistoryUpdated', handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onOpenChange]);

  const loadChats = async () => {
    try {
      const response = await authFetch('/api/history');
      if (response.ok) {
        const data = await response.json();
        setChats(Array.isArray(data) ? data : data.chats || []);
      }
    } catch (error) {
      console.error('Error loading chats:', error);
    }
  };

  const handleNewChat = async () => {
    await onNewChat();
    await loadChats();
  };

  const handleDeleteChat = async (filename, e) => {
    e.stopPropagation();
    if (window.confirm('Chat wirklich löschen?')) {
      try {
        const response = await authFetch(`/api/history/${filename}`, { method: 'DELETE' });
        if (response.ok) {
          await onDeleteChat(filename);
          await loadChats();
        } else {
          alert('Fehler beim Löschen des Chats');
        }
      } catch {
        alert('Fehler beim Löschen des Chats');
      }
    }
  };

  const handleLogout = () => {
    onOpenChange(false);
    logout();
    navigate('/');
  };

  return (
    <aside ref={sidebarRef} className={`sidebar ${isOpen ? 'open' : 'collapsed'}`}>

      <div
        className={`sidebar-hamburger ${isOpen ? 'sidebar-open' : ''}`}
        onClick={() => onOpenChange(!isOpen)}
        title="Menü"
      >
        <svg fill="none" viewBox="0 0 50 50" height="28" width="28">
          <path className="lineTop line" strokeLinecap="round" strokeWidth="4" stroke="white" d="M6 11L44 11" />
          <path className="lineMid line" strokeLinecap="round" strokeWidth="4" stroke="white" d="M6 24H43" />
          <path className="lineBottom line" strokeLinecap="round" strokeWidth="4" stroke="white" d="M6 37H43" />
        </svg>
      </div>

      <div className="sidebar-top">
        <button className="sidebar-icon-btn" onClick={handleNewChat} title="Neuer Chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          {isOpen && <span>Neuer Chat</span>}
        </button>

        <button className="sidebar-icon-btn" title="Chats suchen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {isOpen && <span>Chats suchen</span>}
        </button>
      </div>

      {isOpen && (
        <div className="sidebar-chats-section">
          <p className="sidebar-section-label">Deine Chats</p>
          <div className="chats-list">
            {chats.length === 0 ? (
              <p className="no-chats">Keine Chats vorhanden</p>
            ) : (
              chats.map((chat) => (
                <div
                  key={chat.filename}
                  className={`chat-item ${chat.filename === currentChatId ? 'active' : ''}`}
                  onClick={() => onLoadChat(chat.filename)}
                >
                  <span className="chat-name">{chat.preview || `Chat ${chat.filename.slice(-6)}`}</span>
                  <button
                    className="delete-chat-btn"
                    onClick={(e) => handleDeleteChat(chat.filename, e)}
                    title="Löschen"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" /><path d="M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {!isOpen && <div className="sidebar-spacer" />}

      <div className="sidebar-bottom">
        <div className="sidebar-profile">
          <div className="sidebar-avatar">{initials}</div>
          {isOpen && (
            <>
              <div className="sidebar-profile-info">
                <span className="sidebar-profile-name">{user?.username ?? '—'}</span>
                <span className="sidebar-profile-plan">{user?.plan ?? 'Free'}</span>
              </div>
              <button
                className="sidebar-logout-btn"
                onClick={handleLogout}
                title="Abmelden"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

    </aside>
  );
}