import '../styles/AlertModal.css';

export default function ConfirmationModal({ title, message, onConfirm, onCancel }) {
  const handleConfirm = async () => {
    await onConfirm?.();
  };

  return (
    <div className="alert-modal-backdrop" onClick={onCancel}>
      <div className="alert-modal alert-modal-error" onClick={e => e.stopPropagation()}>
        <div className="alert-modal-header">
          <h2 className="alert-modal-title">
            <span className="alert-modal-icon">!</span>
            {title}
          </h2>
          <button className="alert-modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="alert-modal-body">
          <p>{message}</p>
        </div>
        <div className="alert-modal-footer" style={{ gap: '12px', justifyContent: 'flex-end' }}>
          <button
            className="alert-modal-btn-error"
            style={{ background: 'rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.6)' }}
            onClick={onCancel}
          >
            Abbrechen
          </button>
          <button
            className="alert-modal-btn-error"
            onClick={handleConfirm}
          >
            Bestätigen
          </button>
        </div>
      </div>
    </div>
  );
}
