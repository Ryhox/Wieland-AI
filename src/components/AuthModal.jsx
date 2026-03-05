import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/AuthModal.css';

export default function AuthModal({ isOpen, onClose, onSuccess }) {
  const { login } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const validate = () => {
    if (mode === 'register') {
      if (!form.username || !form.email || !form.password || !form.confirm)
        return 'Bitte alle Felder ausfüllen.';
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(form.username))
        return 'Benutzername: 3–32 Zeichen (Buchstaben, Ziffern, _ -)';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
        return 'Ungültige E-Mail-Adresse.';
      if (form.password.length < 8)
        return 'Passwort muss mindestens 8 Zeichen lang sein.';
      if (form.password !== form.confirm)
        return 'Passwörter stimmen nicht überein.';
    } else {
      if (!form.email || !form.password)
        return 'Bitte alle Felder ausfüllen.';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }

    setLoading(true);
    setError('');

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { email: form.email.trim(), password: form.password }
        : { username: form.username.trim(), email: form.email.trim(), password: form.password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error || 'Fehler aufgetreten.'); return; }

      login(data.token, data.user);
      onSuccess?.();
      onClose();
    } catch {
      setError('Server nicht erreichbar.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setForm({ username: '', email: '', password: '', confirm: '' });
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="auth-modal-overlay" onClick={handleOverlayClick}>
      <div className="auth-modal-card">

        <button className="auth-modal-close" onClick={onClose} aria-label="Schließen">✕</button>

        <div className="auth-modal-header">
          <div className="auth-modal-brand">Wieland</div>
          <h2 className="auth-modal-title">
            {mode === 'login' ? 'Willkommen zurück' : 'Konto erstellen'}
          </h2>
          <p className="auth-modal-subtitle">
            {mode === 'login'
              ? 'Melde dich an, um Nachrichten zu senden'
              : 'Kostenlos starten — läuft vollständig offline'}
          </p>
        </div>

        <div className="auth-modal-tabs">
          <button
            className={`auth-modal-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => switchMode('login')}
            type="button"
          >
            Anmelden
          </button>
          <button
            className={`auth-modal-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => switchMode('register')}
            type="button"
          >
            Registrieren
          </button>
        </div>

        <form className="auth-modal-form" onSubmit={handleSubmit} noValidate>

          {mode === 'register' && (
            <div className="auth-modal-field">
              <label htmlFor="modal-username">Benutzername</label>
              <input
                id="modal-username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="wieland_user"
                value={form.username}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          )}

          <div className="auth-modal-field">
            <label htmlFor="modal-email">E-Mail</label>
            <input
              id="modal-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="deine@email.de"
              value={form.email}
              onChange={handleChange}
              disabled={loading}
              required
            />
          </div>

          <div className="auth-modal-field">
            <label htmlFor="modal-password">Passwort</label>
            <input
              id="modal-password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Mindestens 8 Zeichen"
              value={form.password}
              onChange={handleChange}
              disabled={loading}
              required
            />
          </div>

          {mode === 'register' && (
            <div className="auth-modal-field">
              <label htmlFor="modal-confirm">Passwort bestätigen</label>
              <input
                id="modal-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={form.confirm}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          )}

          {error && <p className="auth-modal-error" role="alert">{error}</p>}

          <button className="auth-modal-submit" type="submit" disabled={loading}>
            {loading
              ? <span className="auth-modal-spinner" />
              : mode === 'login' ? 'Anmelden' : 'Registrieren'}
          </button>
        </form>

        <p className="auth-modal-switch">
          {mode === 'login' ? 'Noch kein Konto?' : 'Bereits ein Konto?'}{' '}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); switchMode(mode === 'login' ? 'register' : 'login'); }}
          >
            {mode === 'login' ? 'Registrieren' : 'Anmelden'}
          </a>
        </p>

      </div>
    </div>
  );
}