import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Profile.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import AlertModal from '../components/AlertModal';
import ConfirmationModal from '../components/ConfirmationModal';

function Profile({ isSidebarOpen, onSidebarToggle }) {
  const { user, authFetch, logout } = useAuth();
  const navigate = useNavigate();

  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [newEmail, setNewEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [alert, setAlert] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const handleEmailChange = async (e) => {
    e.preventDefault();
    setAlert(null);

    if (!newEmail.trim() || newEmail === user?.email) {
      setAlert({ type: 'error', title: 'Fehler', message: 'E-Mail ist identisch oder leer' });
      return;
    }

    try {
      const response = await authFetch('/api/auth/update-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      });

      if (response.ok) {
        setAlert({ type: 'success', title: 'Erfolg', message: 'E-Mail erfolgreich aktualisiert!' });
        setIsEditingEmail(false);
      } else {
        const data = await response.json();
        setAlert({ type: 'error', title: 'Fehler', message: data.error || 'Fehler beim Aktualisieren der E-Mail' });
      }
    } catch (err) {
      setAlert({ type: 'error', title: 'Fehler', message: 'Fehler beim Aktualisieren der E-Mail' });
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setAlert(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setAlert({ type: 'error', title: 'Fehler', message: 'Alle Felder sind erforderlich' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setAlert({ type: 'error', title: 'Fehler', message: 'Neue Passwörter stimmen nicht überein' });
      return;
    }

    if (newPassword.length < 8) {
      setAlert({ type: 'error', title: 'Fehler', message: 'Passwort muss mindestens 8 Zeichen lang sein' });
      return;
    }

    try {
      const response = await authFetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword
        }),
      });

      if (response.ok) {
        setAlert({ type: 'success', title: 'Erfolg', message: 'Passwort erfolgreich aktualisiert!' });
        setIsEditingPassword(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const data = await response.json();
        setAlert({ type: 'error', title: 'Fehler', message: data.error || 'Fehler beim Aktualisieren des Passworts' });
      }
    } catch (err) {
      setAlert({ type: 'error', title: 'Fehler', message: 'Fehler beim Aktualisieren des Passworts' });
    }
  };

  const handleDeleteAccount = async () => {
    setConfirmModal({
      title: 'Konto löschen?',
      message: 'Dies wird dein Konto und alle zugehörigen Daten dauerhaft löschen. Diese Aktion kann nicht rückgängig gemacht werden.',
      onConfirm: async () => {
        try {
          const response = await authFetch('/api/auth/delete-account', {
            method: 'DELETE',
          });

          if (response.ok) {
            logout();
            navigate('/');
          } else {
            const data = await response.json();
            setAlert({ type: 'error', title: 'Fehler', message: data.error || 'Fehler beim Löschen des Kontos' });
          }
        } catch (err) {
          setAlert({ type: 'error', title: 'Fehler', message: 'Fehler beim Löschen des Kontos' });
        }
        setConfirmModal(null);
      }
    });
  };

  const handleCancelSubscription = async () => {
    setConfirmModal({
      title: 'Abonnement kündigen?',
      message: 'Bist du sicher, dass du kündigen möchtest? Du wirst auf den Free-Plan zurückgestuft.',
      onConfirm: async () => {
        try {
          const response = await authFetch('/api/auth/cancel-subscription', {
            method: 'POST',
          });

          if (response.ok) {
            setAlert({ type: 'success', title: 'Erfolg', message: 'Abonnement erfolgreich gekündigt. Du wirst auf Free-Plan zurückgestuft.' });
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          } else {
            const data = await response.json();
            setAlert({ type: 'error', title: 'Fehler', message: data.error || 'Fehler beim Kündigen des Abonnements' });
          }
        } catch (err) {
          setAlert({ type: 'error', title: 'Fehler', message: 'Fehler beim Kündigen des Abonnements' });
        }
        setConfirmModal(null);
      }
    });
  };

  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      {alert && (
        <AlertModal
          type={alert.type}
          title={alert.title}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      {confirmModal && (
        <ConfirmationModal
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      <main className="page-content">
        <div className="page-container profile-container">

          <div className="profile-hero">
            <span className="profile-eyebrow">Profil</span>
            <h1 className="profile-h1">Dein Account<br /><span>verwalten.</span></h1>
            <p className="profile-lead">
              E-Mail, Passwort, Abonnement – alles an einem Ort.
            </p>
          </div>

          <div className="profile-divider" />

          <div className="profile-content">
            <div className="profile-section">
              <h2 className="profile-section-title">E-Mail</h2>
              {!isEditingEmail ? (
                <div className="profile-field">
                  <span className="profile-field-label">Deine E-Mail</span>
                  <div className="profile-field-display">
                    <span>{user?.email || '—'}</span>
                    <button
                      className="profile-btn-secondary"
                      onClick={() => setIsEditingEmail(true)}
                    >
                      Ändern
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleEmailChange} className="profile-form">
                  <div className="profile-form-group">
                    <label>Neue E-Mail</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="neue@email.de"
                      required
                    />
                  </div>
                  <div className="profile-form-buttons">
                    <button type="submit" className="profile-btn-primary">
                      Speichern
                    </button>
                    <button
                      type="button"
                      className="profile-btn-secondary"
                      onClick={() => setIsEditingEmail(false)}
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="profile-divider-thin" />

            <div className="profile-section">
              <h2 className="profile-section-title">Passwort</h2>
              {!isEditingPassword ? (
                <div className="profile-field">
                  <span className="profile-field-label">Passwort ändern</span>
                  <button
                    className="profile-btn-secondary"
                    onClick={() => setIsEditingPassword(true)}
                  >
                    Passwort ändern
                  </button>
                </div>
              ) : (
                <form onSubmit={handlePasswordChange} className="profile-form">
                  <div className="profile-form-group">
                    <label>Aktuelles Passwort</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <div className="profile-form-group">
                    <label>Neues Passwort</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <div className="profile-form-group">
                    <label>Passwort bestätigen</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <div className="profile-form-buttons">
                    <button type="submit" className="profile-btn-primary">
                      Speichern
                    </button>
                    <button
                      type="button"
                      className="profile-btn-secondary"
                      onClick={() => setIsEditingPassword(false)}
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="profile-divider-thin" />

            <div className="profile-section">
              <h2 className="profile-section-title">Abonnement</h2>
              <div className="profile-field">
                <span className="profile-field-label">Plan</span>
                <div className="profile-field-display">
                  <span className="profile-plan-badge">{user?.plan || 'Free'}</span>
                  {user?.plan && user?.plan !== 'Free' && (
                    <button
                      className="profile-btn-danger"
                      onClick={handleCancelSubscription}
                    >
                      Abonnement kündigen
                    </button>
                  )}
                  {(!user?.plan || user?.plan === 'Free') && (
                    <button
                      className="profile-btn-secondary"
                      onClick={() => navigate('/pricing')}
                    >
                      Plan upgraden
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="profile-divider-thin" />

            <div className="profile-section profile-section-danger">
              <h2 className="profile-section-title">Gefahrenzone</h2>
              <div className="profile-field">
                <span className="profile-field-label">Konto löschen</span>
                <p className="profile-field-description">
                  Dies werden dein Konto und alle zugehörigen Daten dauerhaft löschen.
                </p>
                <button
                  className="profile-btn-danger"
                  onClick={handleDeleteAccount}
                >
                  Konto löschen
                </button>
              </div>
            </div>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Profile;
