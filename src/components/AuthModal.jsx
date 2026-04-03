import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import "../styles/AuthModal.css";

// auth modal: login/register form with validation + error handling
export default function AuthModal({ isOpen, onClose, onSuccess }) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // handler separat halten, sonst wird die render-logik schnell wirr
  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError("");
  };

  const validate = () => {
    if (mode === "register") {
      if (!form.username || !form.email || !form.password || !form.confirm)
        return t("auth.errors.fillAll");
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(form.username))
        return t("auth.errors.username");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
        return t("auth.errors.invalidEmail");
      if (form.password.length < 8) return t("auth.errors.passwordLength");
      if (form.password !== form.confirm) return t("auth.errors.passwordMatch");
    } else {
      if (!form.email || !form.password) return t("auth.errors.fillAll");
    }
    return null;
  };

  // user-action flow hier sauber trennen, fehlerpfad sitzt direkt daneben
  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const endpoint =
        mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email: form.email.trim(), password: form.password }
          : {
              username: form.username.trim(),
              email: form.email.trim(),
              password: form.password,
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("auth.errors.generic"));
        return;
      }

      login(data.token, data.user);
      onSuccess?.();
      onClose();
    } catch {
      setError(t("auth.errors.server"));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setForm({ username: "", email: "", password: "", confirm: "" });
  };

  // handler separat halten, sonst wird die render-logik schnell wirr
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="auth-modal-overlay" onClick={handleOverlayClick}>
      <div className="auth-modal-card">
        <button
          className="auth-modal-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          {"\u00D7"}
        </button>

        <div className="auth-modal-header">
          <div className="auth-modal-brand">Wieland</div>
          <h2 className="auth-modal-title">
            {mode === "login" ? t("auth.welcomeBack") : t("auth.createAccount")}
          </h2>
          <p className="auth-modal-subtitle">
            {mode === "login"
              ? t("auth.loginSubtitle")
              : t("auth.registerSubtitle")}
          </p>
        </div>

        <div className="auth-modal-tabs">
          <button
            className={`auth-modal-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => switchMode("login")}
            type="button"
          >
            {t("auth.login")}
          </button>
          <button
            className={`auth-modal-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => switchMode("register")}
            type="button"
          >
            {t("auth.register")}
          </button>
        </div>

        <form className="auth-modal-form" onSubmit={handleSubmit} noValidate>
          {mode === "register" && (
            <div className="auth-modal-field">
              <label htmlFor="modal-username">{t("auth.username")}</label>
              <input
                id="modal-username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder={t("auth.placeholderUsername")}
                value={form.username}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          )}

          <div className="auth-modal-field">
            <label htmlFor="modal-email">{t("auth.email")}</label>
            <input
              id="modal-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t("auth.placeholderEmail")}
              value={form.email}
              onChange={handleChange}
              disabled={loading}
              required
            />
          </div>

          <div className="auth-modal-field">
            <label htmlFor="modal-password">{t("auth.password")}</label>
            <input
              id="modal-password"
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder={t("auth.placeholderPassword")}
              value={form.password}
              onChange={handleChange}
              disabled={loading}
              required
            />
          </div>

          {mode === "register" && (
            <div className="auth-modal-field">
              <label htmlFor="modal-confirm">{t("auth.confirmPassword")}</label>
              <input
                id="modal-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                placeholder={t("auth.placeholderSecret")}
                value={form.confirm}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          )}

          {error && (
            <p className="auth-modal-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="auth-modal-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <span className="auth-modal-spinner" />
            ) : mode === "login" ? (
              t("auth.login")
            ) : (
              t("auth.register")
            )}
          </button>
        </form>

        <p className="auth-modal-switch">
          {mode === "login"
            ? t("auth.switchNoAccount")
            : t("auth.switchHasAccount")}{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              switchMode(mode === "login" ? "register" : "login");
            }}
          >
            {mode === "login" ? t("auth.register") : t("auth.login")}
          </a>
        </p>
      </div>
    </div>
  );
}
