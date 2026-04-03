import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import "../styles/DowngradeModal.css";

export default function DowngradeModal({ plan, onComplete, onClose }) {
  const { t } = useTranslation();
  const { setUser, authFetch } = useAuth();
  const [step, setStep] = useState("confirm");

  useEffect(() => {
    if (step !== "processing") return;

    let active = true;
    let completeTimer;

    const timer = setTimeout(async () => {
      try {
        const response = await authFetch("/api/auth/upgrade-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (active) {
            alert(data.error || t("pricing.planUpdateError"));
            setStep("confirm");
          }
          return;
        }

        const data = await response.json();
        if (active) {
          setUser(data.user);
          setStep("success");
          completeTimer = setTimeout(() => {
            onComplete?.();
          }, 1800);
        }
      } catch (err) {
        console.error("Downgrade plan error:", err);
        if (active) {
          alert(t("pricing.planUpdateError"));
          setStep("confirm");
        }
      }
    }, 1200);

    return () => {
      active = false;
      clearTimeout(timer);
      if (completeTimer) clearTimeout(completeTimer);
    };
  }, [step, plan, onComplete, setUser, authFetch, t]);

  return (
    <div
      className="downgrade-modal-backdrop"
      onClick={step === "processing" ? undefined : onClose}
    >
      <div className="downgrade-modal" onClick={(e) => e.stopPropagation()}>
        {step === "confirm" && (
          <>
            <div className="downgrade-warning-icon">!</div>
            <div className="downgrade-text">
              <h2>{t("purchase.downgradeConfirmTitle")}</h2>
              <p>{t("purchase.downgradeConfirmText", { plan })}</p>
            </div>

            <div className="downgrade-actions">
              <button className="downgrade-cancel-btn" onClick={onClose}>
                {t("confirmModal.cancel")}
              </button>
              <button
                className="downgrade-confirm-btn"
                onClick={() => setStep("processing")}
              >
                {t("purchase.confirmDowngrade")}
              </button>
            </div>
          </>
        )}

        {step === "processing" && (
          <>
            <div className="downgrade-spinner" />
            <div className="downgrade-text">
              <h2>{t("purchase.downgradeProcessing")}</h2>
              <p>{t("purchase.downgrading", { plan })}</p>
            </div>
          </>
        )}

        {step === "success" && (
          <>
            <div className="downgrade-success-icon">✓</div>
            <div className="downgrade-text">
              <h2>{t("purchase.downgradeSuccess")}</h2>
              <p>{t("purchase.downgradeWelcome", { plan })}</p>
            </div>
            <button className="downgrade-close-btn" onClick={onClose}>
              {t("purchase.close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
