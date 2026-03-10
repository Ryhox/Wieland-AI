function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="db-pagination">
      <button className="db-page-btn" disabled={page === 1} onClick={() => onChange(page - 1)}>‹</button>
      <span className="db-page-info">{page} / {totalPages}</span>
      <button className="db-page-btn" disabled={page === totalPages} onClick={() => onChange(page + 1)}>›</button>
    </div>
  );
}

export default function ChatsTable({ chats, total, page, pageSize, loading, onDelete, onPageChange, onView, onUserClick }) {
  const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="db-table-section">
      <div className="db-table-wrap">
        <table className="db-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Titel</th>
              <th>Benutzer</th>
              <th>Nachrichten</th>
              <th>Erstellt</th>
              <th>Aktualisiert</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((__, j) => (
                  <td key={j}><div className="db-skeleton db-skeleton-row" /></td>
                ))}</tr>
              ))
            ) : chats.length === 0 ? (
              <tr><td colSpan={7} className="db-table-empty">Keine Chats gefunden</td></tr>
            ) : (
              chats.map(c => (
                <tr key={c.id} className="db-tr-clickable" onClick={() => onView(c)}>
                  <td className="db-td-muted" onClick={e => e.stopPropagation()}>#{c.id}</td>
                  <td>
                    <div className="db-chat-title-cell">
                      <span className="db-chat-title">{c.title || '—'}</span>
                      <span className="db-chat-filename">{c.filename}</span>
                    </div>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div
                      className="db-user-cell clickable"
                      onClick={() => onUserClick({ username: c.username, id: c.user_id })}
                      title="Benutzer anzeigen"
                    >
                      <div className="db-avatar sm">{c.username?.[0]?.toUpperCase() ?? '?'}</div>
                      <span className="db-user-link">{c.username ?? `#${c.user_id}`}</span>
                    </div>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <span className="db-msg-count-badge">{c.message_count ?? 0}</span>
                  </td>
                  <td className="db-td-muted">{fmtDate(c.created_at)}</td>
                  <td className="db-td-muted">{fmtDate(c.updated_at)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="db-action-btns">
                      <button className="db-icon-btn view" onClick={() => onView(c)} title="Anzeigen">👁</button>
                      <button className="db-icon-btn del" onClick={() => onDelete(c)} title="Löschen">  <svg
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
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="db-table-footer">
        <span className="db-table-count">{total} Chats gesamt</span>
        <Pagination page={page} total={total} pageSize={pageSize} onChange={onPageChange} />
      </div>
    </div>
  );
}