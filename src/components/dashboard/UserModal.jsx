import { useState, useEffect } from 'react';

export default function UserModal({ data, onSave, onClose, onViewChats, onDelete }) {
  const isEdit = !!data;
  const [form, setForm] = useState({ username: '', email: '', password: '', plan: 'Free' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm({ username: data.username, email: data.email, password: '', plan: data.plan ?? 'Free' });
  }, [data]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setError('');
    if (!form.username || !form.email) { setError('Benutzername und E-Mail sind Pflichtfelder.'); return; }
    if (!isEdit && !form.password) { setError('Passwort ist bei Neuanlage Pflichtfeld.'); return; }
    setBusy(true);
    try {
      const payload = { ...form, ...(isEdit ? { id: data.id } : {}) };
      if (!payload.password) delete payload.password;
      await onSave(payload);
    } catch (e) {
      setError(e.message || 'Fehler beim Speichern.');
    } finally { setBusy(false); }
  };

  return (
    <div className="db-modal-backdrop" onClick={onClose}>
      <div className="db-modal" onClick={e => e.stopPropagation()}>
        <div className="db-modal-header">
          <div>
            <h2 className="db-modal-title">{isEdit ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}</h2>
            {isEdit && (
              <span className="db-modal-sub">
                #{data.id} · seit {data.created_at ? new Date(data.created_at).toLocaleDateString('de-DE') : '—'}
              </span>
            )}
          </div>
          <button className="db-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="db-modal-body">
          {error && <div className="db-form-error">{error}</div>}
          <label className="db-form-label">Benutzername
            <input className="db-form-input" value={form.username} onChange={e => set('username', e.target.value)} placeholder="max_mustermann" />
          </label>
          <label className="db-form-label">E-Mail
            <input className="db-form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="max@example.com" />
          </label>
          <label className="db-form-label">
            {isEdit ? 'Neues Passwort (leer = unverändert)' : 'Passwort'}
            <input className="db-form-input" type="password" value={form.password}
              onChange={e => set('password', e.target.value)}
              placeholder={isEdit ? 'Leer lassen zum Beibehalten' : 'Mindestens 8 Zeichen'} />
          </label>
          <label className="db-form-label">Plan
            <select className="db-form-input db-form-select" value={form.plan} onChange={e => set('plan', e.target.value)}>
              {['Free', 'Pro', 'Admin'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <div className="db-modal-footer" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {isEdit && onDelete && (
              <button className="db-btn-danger" onClick={onDelete} disabled={busy}>Löschen</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="db-btn-primary" onClick={handleSubmit} disabled={busy}>
              {busy ? 'Speichern…' : (isEdit ? 'Aktualisieren' : 'Erstellen')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}