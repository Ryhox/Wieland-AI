import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/PurchaseModal.css';

export default function PurchaseModal({ plan, onComplete, onClose }) {
    const { user, setUser, authFetch } = useAuth();
    const [step, setStep] = useState('processing');

    useEffect(() => {
        const timer = setTimeout(async () => {
            try {
                const response = await authFetch('/api/auth/upgrade-plan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plan }),
                });

                if (response.ok) {
                    const data = await response.json();
                    setUser(data.user);
                }
            } catch (err) {
                console.error('Upgrade plan error:', err);
            }

            setStep('success');
            const completeTimer = setTimeout(() => {
                onComplete?.();
            }, 2000);
            return () => clearTimeout(completeTimer);
        }, 2500);
        return () => clearTimeout(timer);
    }, [plan, onComplete, setUser, authFetch]);

    return (
        <div className="purchase-modal-backdrop" onClick={step === 'success' ? onClose : undefined}>
            <div className="purchase-modal" onClick={e => e.stopPropagation()}>
                {step === 'processing' && (
                    <>
                        <div className="purchase-spinner" />
                        <div className="purchase-text">
                            <h2>Zahlung wird bearbeitet...</h2>
                            <p>Upgrading auf {plan} Plan</p>
                        </div>
                    </>
                )}

                {step === 'success' && (
                    <>
                        <div className="purchase-success-icon">✓</div>
                        <div className="purchase-text">
                            <h2>Upgrade erfolgreich!</h2>
                            <p>Willkommen im {plan} Plan. Viel Spaß!</p>
                        </div>
                        <button className="purchase-close-btn" onClick={onClose}>
                            Schließen
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
