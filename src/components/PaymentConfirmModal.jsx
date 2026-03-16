import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/PaymentConfirmModal.css';

export default function PaymentConfirmModal({ onConfirm, onClose, plan = 'Pro', price = 4.99 }) {
    const { user } = useAuth();
    const [selectedMethod, setSelectedMethod] = useState('card');

    const PAYMENT_METHODS = [
        { id: 'card', name: 'Kreditkarte', icon: '/icons/card.png', details: '•••• •••• •••• 3874', issuer: 'Max Mustermann' },
        { id: 'paypal', name: 'PayPal', icon: '/icons/paypal.png', details: user?.email || 'PayPal Account' },
        { id: 'apple', name: 'Apple Pay', icon: '/icons/apple-pay.png', details: 'Apple Card' },
        { id: 'google', name: 'Google Pay', icon: '/icons/google-pay.png', details: 'Google Account' },
    ];

    const payment = PAYMENT_METHODS.find(m => m.id === selectedMethod) || PAYMENT_METHODS[0];

    return (
        <div className="payment-confirm-backdrop" onClick={onClose}>
            <div className="payment-confirm-modal" onClick={e => e.stopPropagation()}>

                <div className="payment-confirm-header">
                    <h2>Zahlungsmethode & Bestätigung</h2>
                    <button className="payment-confirm-close" onClick={onClose}>✕</button>
                </div>

                <div className="payment-confirm-content">

                    <div className="payment-confirm-left">
                        <h3 className="payment-methods-title">Zahlungsmethode</h3>

                        <div className="payment-methods-list">
                            {PAYMENT_METHODS.map(method => (
                                <button
                                    key={method.id}
                                    className={`payment-method-item ${selectedMethod === method.id ? 'active' : ''}`}
                                    onClick={() => setSelectedMethod(method.id)}
                                >
                                    <img src={method.icon} alt={method.name} className="payment-method-item-icon" />
                                    <div className="payment-method-item-info">
                                        <span className="payment-method-item-name">{method.name}</span>
                                        <span className="payment-method-item-detail">{method.details}</span>
                                    </div>
                                </button>
                            ))}
                        </div>

                        <p className="payment-security-note">
                            Alle Zahlungen werden sicher durch verarbeitet.
                        </p>
                    </div>

                    <div className="payment-confirm-right">
                        <h3 className="plan-info-title">{plan}</h3>
                        <p className="plan-info-subtitle">Du wirst dieses Konto upgraden.</p>
                        <br></br>
                        <div className="plan-details">
                            <div className="plan-detail-row">
                                <span className="plan-detail-label">Plan:</span>
                                <span className="plan-detail-value">{plan}</span>
                            </div>
                            <div className="plan-detail-row">
                                <span className="plan-detail-label">Laufzeit:</span>
                                <span className="plan-detail-value">Monatlich kündbar</span>
                            </div>
                        </div>

                        <div className="plan-price-section">
                            <span className="plan-price-amount">${price.toFixed(2)}</span>
                            <span className="plan-price-period">/Monat</span>
                            <p className="plan-price-note">Zzgl. Steuern</p>
                        </div>

                        <button className="payment-confirm-btn" onClick={onConfirm}>
                            Upgrade bestätigen
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}
