import { useState } from 'react';

export default function ConfirmModal({ label, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  };

  return (
    <div className="db-modal-backdrop" onClick={onClose}>
      <div className="db-modal db-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="db-modal-header">
          <h2 className="db-modal-title">Bestätigen</h2>
          <button className="db-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="db-modal-body">
          <p className="db-confirm-text">{label}</p>
        </div>
        <div className="db-modal-footer">
          <button className="db-btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="db-btn-danger" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Löschen…' : 'Endgültig löschen'}
          </button>
        </div>
      </div>
    </div>
  );
}