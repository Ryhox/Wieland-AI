import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function UserModal({
  data,
  onSave,
  onClose,
  onViewChats,
  onDelete,
}) {
  const { t } = useTranslation();
  const isEdit = !!data;
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    plan: "Free",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data)
      setForm({
        username: data.username,
        email: data.email,
        password: "",
        plan: data.plan ?? "Free",
      });
  }, [data]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setError("");
    if (!form.username || !form.email) {
      setError(t("dashboard.userModal.requiredUserMail"));
      return;
    }
    if (!isEdit && !form.password) {
      setError(t("dashboard.userModal.requiredPassword"));
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, ...(isEdit ? { id: data.id } : {}) };
      if (!payload.password) delete payload.password;
      await onSave(payload);
    } catch (e) {
      setError(e.message || t("dashboard.userModal.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="db-modal-backdrop" onClick={onClose}>
      <div className="db-modal" onClick={(e) => e.stopPropagation()}>
        <div className="db-modal-header">
          <div>
            <h2 className="db-modal-title">
              {isEdit
                ? t("dashboard.userModal.editUser")
                : t("dashboard.userModal.newUser")}
            </h2>
            {isEdit && (
              <span className="db-modal-sub">
                #{data.id} · {t("dashboard.userModal.since")}{" "}
                {data.created_at
                  ? new Date(data.created_at).toLocaleDateString("de-DE")
                  : "—"}
              </span>
            )}
          </div>
          <button className="db-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="db-modal-body">
          {error && <div className="db-form-error">{error}</div>}
          <label className="db-form-label">
            {t("dashboard.table.username")}
            <input
              className="db-form-input"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              placeholder={t("dashboard.userModal.usernamePlaceholder")}
            />
          </label>
          <label className="db-form-label">
            {t("dashboard.table.email")}
            <input
              className="db-form-input"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder={t("dashboard.userModal.emailPlaceholder")}
            />
          </label>
          <label className="db-form-label">
            {isEdit
              ? t("dashboard.userModal.newPasswordOptional")
              : t("auth.password")}
            <input
              className="db-form-input"
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={
                isEdit
                  ? t("dashboard.userModal.keepPassword")
                  : t("auth.placeholderPassword")
              }
            />
          </label>
          <label className="db-form-label">
            {t("profile.plan")}
            <select
              className="db-form-input db-form-select"
              value={form.plan}
              onChange={(e) => set("plan", e.target.value)}
            >
              {["Free", "Pro", "Max", "Admin"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="db-modal-footer"
          style={{ justifyContent: "space-between" }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {isEdit && onDelete && (
              <button
                className="db-btn-danger"
                onClick={onDelete}
                disabled={busy}
              >
                {t("common.delete")}
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="db-btn-primary"
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy
                ? t("dashboard.userModal.saving")
                : isEdit
                  ? t("dashboard.userModal.update")
                  : t("dashboard.userModal.create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
