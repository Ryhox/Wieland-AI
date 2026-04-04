import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import "../styles/Profile.css";
import "../styles/main.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import AlertModal from "../components/AlertModal";
import ConfirmationModal from "../components/ConfirmationModal";
import { withLang } from "../utils/i18nRouting";

// user profil page: account info (email/password), memories management, subscriptions, deletion
// handlers für: email ändern, password ändern, memories löschen, account delete, subscription cancel
function Profile({ isSidebarOpen, onSidebarToggle }) {
  const { t, i18n } = useTranslation();
  const { user, authFetch, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const localPath = (path) => withLang(path, i18n.language);

  const isAdmin = (user?.plan || "").toLowerCase() === "admin";
  const displayName =
    String(user?.username || "").trim() ||
    String(user?.email || "").split("@")[0] ||
    "---";
  const profileInitials = getProfileInitials(displayName);

  // edit modes: welche sektion wird gerade editiert?
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState(user?.username || "");
  const [newEmail, setNewEmail] = useState(user?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [alert, setAlert] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [memoryItems, setMemoryItems] = useState([]);
  const [isMemoryLoading, setIsMemoryLoading] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState(null);
  const [isDeletingAllMemory, setIsDeletingAllMemory] = useState(false);

  const handleDisplayNameChange = async (e) => {
    e.preventDefault();
    setAlert(null);

    const trimmedName = String(newDisplayName || "").trim();
    if (!trimmedName || trimmedName === user?.username) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.displayNameSame"),
      });
      return;
    }

    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(trimmedName)) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.displayNameInvalid"),
      });
      return;
    }

    try {
      const response = await authFetch("/api/auth/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setAlert({
          type: "success",
          title: t("profile.errors.success"),
          message: t("profile.success.displayNameUpdated"),
        });
        setIsEditingDisplayName(false);
      } else {
        const data = await response.json().catch(() => ({}));
        setAlert({
          type: "error",
          title: t("profile.errors.title"),
          message: data.error || t("profile.errors.displayNameUpdate"),
        });
      }
    } catch (err) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.displayNameUpdate"),
      });
    }
  };

  // user-action flow hier sauber trennen, fehlerpfad sitzt direkt daneben
  const handleEmailChange = async (e) => {
    e.preventDefault();
    setAlert(null);

    if (!newEmail.trim() || newEmail === user?.email) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.emailSame"),
      });
      return;
    }

    try {
      const response = await authFetch("/api/auth/update-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      });

      if (response.ok) {
        setAlert({
          type: "success",
          title: t("profile.errors.success"),
          message: t("profile.success.emailUpdated"),
        });
        setIsEditingEmail(false);
      } else {
        const data = await response.json();
        setAlert({
          type: "error",
          title: t("profile.errors.title"),
          message: data.error || t("profile.errors.emailUpdate"),
        });
      }
    } catch (err) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.emailUpdate"),
      });
    }
  };

  // user-action flow hier sauber trennen, fehlerpfad sitzt direkt daneben
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setAlert(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.passwordFields"),
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.passwordMismatch"),
      });
      return;
    }

    if (newPassword.length < 8) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.passwordLength"),
      });
      return;
    }

    try {
      const response = await authFetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (response.ok) {
        setAlert({
          type: "success",
          title: t("profile.errors.success"),
          message: t("profile.success.passwordUpdated"),
        });
        setIsEditingPassword(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const data = await response.json();
        setAlert({
          type: "error",
          title: t("profile.errors.title"),
          message: data.error || t("profile.errors.passwordUpdate"),
        });
      }
    } catch (err) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: t("profile.errors.passwordUpdate"),
      });
    }
  };

  // user-action flow hier sauber trennen, fehlerpfad sitzt direkt daneben
  const handleDeleteAccount = async () => {
    setConfirmModal({
      title: t("profile.confirm.deleteTitle"),
      message: t("profile.confirm.deleteText"),
      onConfirm: async () => {
        try {
          const response = await authFetch("/api/auth/delete-account", {
            method: "DELETE",
          });

          if (response.ok) {
            logout();
            navigate(localPath("/"));
          } else {
            const data = await response.json();
            setAlert({
              type: "error",
              title: t("profile.errors.title"),
              message: data.error || t("profile.errors.accountDelete"),
            });
          }
        } catch (err) {
          setAlert({
            type: "error",
            title: t("profile.errors.title"),
            message: t("profile.errors.accountDelete"),
          });
        }
        setConfirmModal(null);
      },
    });
  };

  const handleLogout = () => {
    logout();
    navigate(localPath("/"));
  };

  const handleCancelSubscription = async () => {
    setConfirmModal({
      title: t("profile.confirm.cancelTitle"),
      message: t("profile.confirm.cancelText"),
      onConfirm: async () => {
        try {
          const response = await authFetch("/api/auth/cancel-subscription", {
            method: "POST",
          });

          if (response.ok) {
            setAlert({
              type: "success",
              title: t("profile.errors.success"),
              message: t("profile.success.subscriptionCanceled"),
            });
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          } else {
            const data = await response.json();
            setAlert({
              type: "error",
              title: t("profile.errors.title"),
              message: data.error || t("profile.errors.subscriptionCancel"),
            });
          }
        } catch (err) {
          setAlert({
            type: "error",
            title: t("profile.errors.title"),
            message: t("profile.errors.subscriptionCancel"),
          });
        }
        setConfirmModal(null);
      },
    });
  };

  const fetchMemories = async () => {
    setIsMemoryLoading(true);
    try {
      const response = await authFetch("/api/auth/memories");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t("profile.errors.memoryLoad"));
      }
      const data = await response.json();
      setMemoryItems(Array.isArray(data.memories) ? data.memories : []);
    } catch (err) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: err?.message || t("profile.errors.memoryLoad"),
      });
    } finally {
      setIsMemoryLoading(false);
    }
  };

  const openMemoryModal = async () => {
    setMemoryModalOpen(true);
    await fetchMemories();
  };

  const closeMemoryModal = () => {
    if (isMemoryLoading || isDeletingAllMemory || deletingMemoryId) return;
    setMemoryModalOpen(false);
  };

  const handleDeleteMemory = async (memoryId) => {
    if (!memoryId || deletingMemoryId || isDeletingAllMemory) return;

    setDeletingMemoryId(memoryId);
    try {
      const response = await authFetch(`/api/auth/memories/${memoryId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t("profile.errors.memoryDelete"));
      }

      setMemoryItems((prev) => prev.filter((item) => item.id !== memoryId));
      setAlert({
        type: "success",
        title: t("profile.errors.success"),
        message: t("profile.success.memoryDeleted"),
      });
    } catch (err) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: err?.message || t("profile.errors.memoryDelete"),
      });
    } finally {
      setDeletingMemoryId(null);
    }
  };

  const handleDeleteAllMemory = async () => {
    if (!memoryItems.length || isDeletingAllMemory || deletingMemoryId) return;

    setIsDeletingAllMemory(true);
    try {
      const response = await authFetch("/api/auth/memories", {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t("profile.errors.memoryDeleteAll"));
      }

      setMemoryItems([]);
      setAlert({
        type: "success",
        title: t("profile.errors.success"),
        message: t("profile.success.memoryCleared"),
      });
    } catch (err) {
      setAlert({
        type: "error",
        title: t("profile.errors.title"),
        message: err?.message || t("profile.errors.memoryDeleteAll"),
      });
    } finally {
      setIsDeletingAllMemory(false);
    }
  };

  return (
    <div
      className={`page-wrapper content-page ${isSidebarOpen ? "sidebar-open" : ""}`}
    >
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}

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
            <span className="profile-eyebrow">{t("profile.eyebrow")}</span>
            <h1 className="profile-h1">
              {t("profile.title")}
              <br />
              <span>{t("profile.titleAccent")}</span>
            </h1>
            <p className="profile-lead">{t("profile.lead")}</p>
          </div>

          <div className="profile-divider" />

          <div className="profile-content">
            <section className="profile-group">
              <h2 className="profile-group-title">
                {t("profile.accountSection", { defaultValue: "Konto" })}
              </h2>
              {!isEditingDisplayName ? (
                <div className="profile-row-card">
                  <div className="profile-row-left profile-account-left">
                    <div className="profile-avatar" aria-hidden="true">
                      {profileInitials}
                    </div>
                    <div className="profile-row-text">
                      <span className="profile-row-title">{displayName}</span>
                      <span className="profile-row-meta">
                        {t("profile.displayNameLabel", {
                          defaultValue: "Anzeigename",
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="profile-row-right">
                    <button
                      className="profile-btn-secondary"
                      onClick={() => {
                        setNewDisplayName(user?.username || "");
                        setIsEditingDisplayName(true);
                      }}
                    >
                      {t("profile.change")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="profile-row-card profile-row-card-edit">
                  <form
                    onSubmit={handleDisplayNameChange}
                    className="profile-form"
                  >
                    <div className="profile-form-group">
                      <label>
                        {t("profile.displayNameLabel", {
                          defaultValue: "Anzeigename",
                        })}
                      </label>
                      <input
                        type="text"
                        value={newDisplayName}
                        onChange={(e) => setNewDisplayName(e.target.value)}
                        placeholder={t("profile.displayNameLabel")}
                        required
                      />
                    </div>
                    <div className="profile-form-buttons">
                      <button type="submit" className="profile-btn-primary">
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        className="profile-btn-secondary"
                        onClick={() => setIsEditingDisplayName(false)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>

            <section className="profile-group">
              <h2 className="profile-group-title">
                {t("profile.contactSection", {
                  defaultValue: "Kontaktdaten",
                })}
              </h2>
              {!isEditingEmail ? (
                <div className="profile-row-card">
                  <div className="profile-row-left">
                    <div className="profile-row-text">
                      <span className="profile-row-label">
                        {t("profile.emailSection", { defaultValue: "E-Mail" })}
                      </span>
                      <span className="profile-row-value">
                        {user?.email || "---"}
                      </span>
                    </div>
                  </div>
                  <div className="profile-row-right">
                    <button
                      className="profile-btn-secondary"
                      onClick={() => setIsEditingEmail(true)}
                    >
                      {t("profile.change")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="profile-row-card profile-row-card-edit">
                  <form onSubmit={handleEmailChange} className="profile-form">
                    <div className="profile-form-group">
                      <label>{t("profile.newEmail")}</label>
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder={t("auth.placeholderEmail")}
                        required
                      />
                    </div>
                    <div className="profile-form-buttons">
                      <button type="submit" className="profile-btn-primary">
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        className="profile-btn-secondary"
                        onClick={() => setIsEditingEmail(false)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>

            <section className="profile-group">
              <h2 className="profile-group-title">
                {t("profile.securitySection", { defaultValue: "Sicherheit" })}
              </h2>
              {!isEditingPassword ? (
                <div className="profile-row-card">
                  <div className="profile-row-left">
                    <div className="profile-row-text">
                      <span className="profile-row-label">
                        {t("profile.passwordSection", {
                          defaultValue: "Passwort",
                        })}
                      </span>
                      <span className="profile-row-value profile-password-dots">
                        **********
                      </span>
                    </div>
                  </div>
                  <div className="profile-row-right">
                    <button
                      className="profile-btn-secondary"
                      onClick={() => setIsEditingPassword(true)}
                    >
                      {t("profile.changePassword")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="profile-row-card profile-row-card-edit">
                  <form
                    onSubmit={handlePasswordChange}
                    className="profile-form"
                  >
                    <div className="profile-form-group">
                      <label>{t("profile.currentPassword")}</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="********"
                        required
                      />
                    </div>
                    <div className="profile-form-group">
                      <label>{t("profile.newPassword")}</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="********"
                        required
                      />
                    </div>
                    <div className="profile-form-group">
                      <label>{t("profile.confirmPassword")}</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="********"
                        required
                      />
                    </div>
                    <div className="profile-form-buttons">
                      <button type="submit" className="profile-btn-primary">
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        className="profile-btn-secondary"
                        onClick={() => setIsEditingPassword(false)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>

            <section className="profile-group">
              <h2 className="profile-group-title">
                {t("profile.subscription")}
              </h2>
              <div className="profile-row-card">
                <div className="profile-row-left">
                  <div className="profile-row-text">
                    <span className="profile-plan-inline">
                      <span className="profile-row-label">
                        {t("profile.plan")}
                      </span>
                      <span className="profile-plan-badge">
                        {user?.plan || "Free"}
                      </span>
                    </span>
                    <span className="profile-row-meta">
                      {isAdmin
                        ? t("profile.adminNoCancel")
                        : user?.plan && user?.plan !== "Free"
                          ? t("profile.subscriptionPaidHint", {
                              defaultValue:
                                "Du kannst dein Abonnement jederzeit kündigen.",
                            })
                          : t("profile.subscriptionFreeHint", {
                              defaultValue:
                                "Upgrade für mehr Leistung und Funktionen.",
                            })}
                    </span>
                  </div>
                </div>
                <div className="profile-row-right">
                  {user?.plan && user?.plan !== "Free" && !isAdmin && (
                    <button
                      className="profile-btn-danger"
                      onClick={handleCancelSubscription}
                    >
                      {t("profile.cancelSubscription")}
                    </button>
                  )}
                  {(!user?.plan || user?.plan === "Free") && (
                    <button
                      className="profile-btn-secondary"
                      onClick={() => navigate(localPath("/pricing"))}
                    >
                      {t("profile.upgradePlan")}
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="profile-group">
              <h2 className="profile-group-title">
                {t("profile.memorySection")}
              </h2>
              <div className="profile-row-card">
                <div className="profile-row-left">
                  <span className="profile-card-icon" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M12 8.8v3.8l2.6 1.7"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="profile-row-text">
                    <span className="profile-row-title">
                      {t("profile.memoryLabel")}
                    </span>
                    <span className="profile-row-meta">
                      {t("profile.memoryDescription")}
                    </span>
                  </div>
                </div>
                <div className="profile-row-right">
                  <button
                    className="profile-btn-secondary"
                    onClick={openMemoryModal}
                  >
                    {t("profile.openMemory")}
                  </button>
                </div>
              </div>
            </section>

            <section className="profile-group">
              <h2 className="profile-group-title">{t("profile.dangerZone")}</h2>
              <div className="profile-row-card">
                <div className="profile-row-left">
                  <div className="profile-row-text">
                    <span className="profile-row-title">{t("sidebar.logout")}</span>
                    <span className="profile-row-meta">
                      {t("profile.logoutDescription", {
                        defaultValue: "Meldet dich aus deinem Konto ab.",
                      })}
                    </span>
                  </div>
                </div>
                <div className="profile-row-right">
                  <button
                    className="profile-btn-secondary"
                    onClick={handleLogout}
                  >
                    {t("sidebar.logout")}
                  </button>
                </div>
              </div>

              <div className="profile-row-card profile-row-card-danger">
                <div className="profile-row-left">
                  <div className="profile-row-text">
                    <span className="profile-row-title">
                      {t("profile.deleteAccount")}
                    </span>
                    <span className="profile-row-meta">
                      {t("profile.deleteDescription")}
                    </span>
                  </div>
                </div>
                <div className="profile-row-right">
                  <button
                    className="profile-btn-danger"
                    onClick={handleDeleteAccount}
                  >
                    {t("profile.deleteAccount")}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {memoryModalOpen && (
        <MemoryModal
          memories={memoryItems}
          loading={isMemoryLoading}
          deletingMemoryId={deletingMemoryId}
          deletingAll={isDeletingAllMemory}
          language={i18n.language}
          onClose={closeMemoryModal}
          onRefresh={fetchMemories}
          onDeleteOne={handleDeleteMemory}
          onDeleteAll={handleDeleteAllMemory}
        />
      )}

      <Footer />
    </div>
  );
}

// helper-block für parsing/aufbereitung, nimmt unten viel chaos raus
function normalizeProfileLocale(language = "de") {
  const lang = String(language || "de").toLowerCase();
  if (lang.startsWith("en")) return "en-US";
  if (lang.startsWith("it")) return "it-IT";
  return "de-DE";
}

function getProfileInitials(name = "") {
  const clean = String(name || "").trim();
  if (!clean) return "--";

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function fallbackMemoryLabel(key = "") {
  if (!key) return "-";
  return String(key)
    .replace(/^favorite_/i, "favorite ")
    .replace(/^note_/i, "note ")
    .replace(/_/g, " ")
    .trim();
}

function formatMemoryDate(value, language = "de") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(normalizeProfileLocale(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MemoryModal({
  memories,
  loading,
  deletingMemoryId,
  deletingAll,
  language,
  onClose,
  onRefresh,
  onDeleteOne,
  onDeleteAll,
}) {
  const { t } = useTranslation();

  return (
    <div className="profile-memory-backdrop" onClick={onClose}>
      <div
        className="profile-memory-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-memory-modal-header">
          <div>
            <h2 className="profile-memory-modal-title">
              {t("profile.memoryModalTitle")}
            </h2>
            <span className="profile-memory-modal-sub">
              {t("profile.memoryModalSub", { count: memories.length })}
            </span>
          </div>
          <button
            className="profile-memory-modal-close"
            onClick={onClose}
            disabled={loading || deletingAll || Boolean(deletingMemoryId)}
          >
            {"\u00D7"}
          </button>
        </div>

        <div className="profile-memory-modal-body">
          {loading ? (
            <p className="profile-memory-empty">{t("common.loading")}</p>
          ) : memories.length === 0 ? (
            <p className="profile-memory-empty">{t("profile.memoryEmpty")}</p>
          ) : (
            <div className="profile-memory-list">
              {memories.map((memory) => (
                <div key={memory.id} className="profile-memory-item">
                  <div className="profile-memory-item-main">
                    <span className="profile-memory-item-key">
                      {memory.label || fallbackMemoryLabel(memory.key)}
                    </span>
                    <p className="profile-memory-item-value">{memory.value}</p>
                    <div className="profile-memory-item-meta">
                      <span>
                        {t("profile.memoryUpdatedAt", {
                          date: formatMemoryDate(memory.updatedAt, language),
                        })}
                      </span>
                      <span>
                        {memory.isExplicit
                          ? t("profile.memoryTypeExplicit")
                          : t("profile.memoryTypeAuto")}
                      </span>
                      <span>
                        {t("profile.memoryUsage", {
                          count: Number(memory.usageCount || 0),
                        })}
                      </span>
                    </div>
                  </div>

                  <button
                    className="profile-memory-btn-danger profile-memory-item-delete"
                    onClick={() => onDeleteOne(memory.id)}
                    disabled={deletingAll || deletingMemoryId === memory.id}
                  >
                    {deletingMemoryId === memory.id
                      ? t("common.loading")
                      : t("common.delete")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="profile-memory-modal-footer">
          <span className="profile-memory-count">
            {t("profile.memoryCount", { count: memories.length })}
          </span>
          <div className="profile-memory-footer-actions">
            <button
              className="profile-memory-btn-ghost"
              onClick={onRefresh}
              disabled={loading || deletingAll || Boolean(deletingMemoryId)}
            >
              {t("common.refresh")}
            </button>
            <button
              className="profile-memory-btn-danger"
              onClick={onDeleteAll}
              disabled={
                loading ||
                deletingAll ||
                Boolean(deletingMemoryId) ||
                memories.length === 0
              }
            >
              {deletingAll ? t("common.loading") : t("profile.memoryDeleteAll")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Profile;
