import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import "../styles/PurchaseModal.css";

// purchase modal: process plan upgrade with loading + success animation
export default function PurchaseModal({ plan, onComplete, onClose }) {
  const { t } = useTranslation();
  const { setUser, authFetch } = useAuth();
  const [step, setStep] = useState("processing");

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const response = await authFetch("/api/auth/upgrade-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
        }
      } catch (err) {
        console.error("Upgrade plan error:", err);
      }

      setStep("success");
      const completeTimer = setTimeout(() => {
        onComplete?.();
      }, 2000);
      return () => clearTimeout(completeTimer);
    }, 2500);
    return () => clearTimeout(timer);
  }, [plan, onComplete, setUser, authFetch]);

  return (
    <div
      className="purchase-modal-backdrop"
      onClick={step === "success" ? onClose : undefined}
    >
      <div className="purchase-modal" onClick={(e) => e.stopPropagation()}>
        {step === "processing" && (
          <>
            <div className="purchase-spinner" />
            <div className="purchase-text">
              <h2>{t("purchase.processing")}</h2>
              <p>{t("purchase.upgrading", { plan })}</p>
            </div>
          </>
        )}

        {step === "success" && (
          <>
            <div className="purchase-success-icon">✓</div>
            <div className="purchase-text">
              <h2>{t("purchase.success")}</h2>
              <p>{t("purchase.welcome", { plan })}</p>
            </div>
            <button className="purchase-close-btn" onClick={onClose}>
              {t("purchase.close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
