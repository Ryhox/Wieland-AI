import { useState, useEffect } from 'react';
import '../styles/AlertModal.css';

export default function AlertModal({ type = 'success', title, message, onClose }) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!isVisible) {
      setTimeout(() => onClose?.(), 300);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="alert-modal-backdrop" onClick={() => setIsVisible(false)}>
      <div className={`alert-modal alert-modal-${type}`} onClick={e => e.stopPropagation()}>
        <div className="alert-modal-header">
          <h2 className="alert-modal-title">
            <span className="alert-modal-icon">
              {type === 'success' ? '✓' : '✕'}
            </span>
            {title}
          </h2>
          <button className="alert-modal-close" onClick={() => setIsVisible(false)}>✕</button>
        </div>
        <div className="alert-modal-body">
          <p>{message}</p>
        </div>
        <div className="alert-modal-footer">
          <button
            className={type === 'success' ? 'alert-modal-btn-success' : 'alert-modal-btn-error'}
            onClick={() => setIsVisible(false)}
          >
            Okay
          </button>
        </div>
      </div>
    </div>
  );
}
