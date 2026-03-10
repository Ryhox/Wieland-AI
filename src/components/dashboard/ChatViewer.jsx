import { useState, useEffect, useRef } from 'react';

function renderMarkdown(raw = '') {
    return raw
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/gs, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gs, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br />');
}

export default function ChatViewer({ chat, authFetch, onClose, onUserClick, onDelete }) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const endRef = useRef(null);

    useEffect(() => {
        if (!chat) return;
        setLoading(true);
        setError('');
        authFetch(`/api/admin/chats/${chat.id}/messages`)
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(d => { setMessages(d.messages ?? []); setLoading(false); })
            .catch(() => { setError('Nachrichten konnten nicht geladen werden.'); setLoading(false); });
    }, [chat]);

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    if (!chat) return null;

    const fmtDate = d => d ? new Date(d).toLocaleString('de-DE') : '—';

    return (
        <div className="db-modal-backdrop" onClick={onClose}>
            <div className="db-modal db-modal-wide" onClick={e => e.stopPropagation()}>
                <div className="db-modal-header">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 className="db-modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {chat.title || chat.filename}
                        </h2>
                        <div className="db-chat-meta-row">
                            {chat.username && (
                                <button className="db-meta-user-btn" onClick={() => onUserClick({ username: chat.username, id: chat.user_id })}>
                                    <div className="db-avatar sm">{chat.username[0]?.toUpperCase()}</div>
                                    {chat.username}
                                </button>
                            )}
                            <span className="db-meta-sep">·</span>
                            <span className="db-meta-info">{chat.message_count ?? messages.length} Nachrichten</span>
                            <span className="db-meta-sep">·</span>
                            <span className="db-meta-info">{fmtDate(chat.updated_at)}</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                        <button className="db-icon-btn del" onClick={() => onDelete(chat)} title="Chat löschen">    <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M9 6V4h6v2" />
                        </svg></button>
                        <button className="db-modal-close" onClick={onClose}>✕</button>
                    </div>
                </div>

                <div className="db-chat-viewer-body">
                    {loading && (
                        <div className="db-chat-loading">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className={`db-chat-skel-row ${i % 2 === 0 ? 'right' : 'left'}`}>
                                    <div className="db-skeleton" style={{ height: 48, width: `${40 + Math.random() * 30}%`, borderRadius: 12 }} />
                                </div>
                            ))}
                        </div>
                    )}
                    {error && <div className="db-form-error" style={{ margin: 16 }}>{error}</div>}
                    {!loading && !error && messages.length === 0 && (
                        <p className="db-chat-empty">Keine Nachrichten in diesem Chat.</p>
                    )}
                    {!loading && messages.map((m, i) => (
                        <div key={i} className={`db-cv-message ${m.role === 'user' ? 'user' : 'ai'}`}>
                            <div className="db-cv-bubble">
                                {m.role === 'user' ? (
                                    <span>{m.content}</span>
                                ) : (
                                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                                )}
                            </div>
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>

                <div className="db-modal-footer">
                    <span className="db-table-count">{messages.length} Nachrichten · {chat.filename}</span>
                </div>
            </div>
        </div>
    );
}