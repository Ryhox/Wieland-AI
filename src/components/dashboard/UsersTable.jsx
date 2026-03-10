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

export default function UsersTable({ users, total, page, pageSize, loading, onEdit, onDelete, onPageChange, onViewChats }) {
  const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="db-table-section">
      <div className="db-table-wrap">
        <table className="db-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Benutzername</th>
              <th>E-Mail</th>
              <th>Plan</th>
              <th>Registriert</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                  <td key={j}><div className="db-skeleton db-skeleton-row" /></td>
                ))}</tr>
              ))
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="db-table-empty">Keine Benutzer gefunden</td></tr>
            ) : (
              users.map(u => (
                <tr key={u.id} className="db-tr-clickable" onClick={() => onEdit(u)}>
                  <td className="db-td-muted" onClick={e => e.stopPropagation()}>#{u.id}</td>
                  <td>
                    <div className="db-user-cell">
                      <div className="db-avatar sm">{u.username?.[0]?.toUpperCase()}</div>
                      <span>{u.username}</span>
                    </div>
                  </td>
                  <td className="db-td-muted">{u.email}</td>
                  <td><span className={`db-plan-badge ${u.plan?.toLowerCase()}`}>{u.plan}</span></td>
                  <td className="db-td-muted">{fmtDate(u.created_at)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="db-action-btns">
                      <button className="db-icon-btn chats" onClick={() => onViewChats(u)} title="Chats anzeigen">💬</button>
                      <button className="db-icon-btn edit" onClick={() => onEdit(u)} title="Bearbeiten">✎</button>
                      <button
                        className="db-icon-btn del"
                        onClick={() => onDelete(u)}
                        title="Löschen"
                      >
                        <svg
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
                        </svg></button>                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="db-table-footer">
        <span className="db-table-count">{total} Benutzer gesamt</span>
        <Pagination page={page} total={total} pageSize={pageSize} onChange={onPageChange} />
      </div>
    </div>
  );
}