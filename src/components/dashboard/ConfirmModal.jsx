import { useState } from "react";
import { useTranslation } from "react-i18next";

// confirm modal: deletion confirmation dialog mit busy state für async delete
export default function ConfirmModal({ label, onConfirm, onClose }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  // user-action flow hier sauber trennen, fehlerpfad sitzt direkt daneben
  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="db-modal-backdrop" onClick={onClose}>
      <div
        className="db-modal db-modal-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="db-modal-header">
          <h2 className="db-modal-title">
            {t("dashboard.confirmModal.title")}
          </h2>
          <button className="db-modal-close" onClick={onClose}>
            {"\u00D7"}
          </button>
        </div>
        <div className="db-modal-body">
          <p className="db-confirm-text">{label}</p>
        </div>
        <div className="db-modal-footer">
          <button className="db-btn-ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            className="db-btn-danger"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy
              ? t("dashboard.confirmModal.deleting")
              : t("dashboard.confirmModal.deleteForever")}
          </button>
        </div>
      </div>
    </div>
  );
}
