import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import "../styles/PaymentConfirmModal.css";

// payment confirm modal: select payment method (card, paypal, apple-pay, google-pay)
export default function PaymentConfirmModal({
  onConfirm,
  onClose,
  plan = "Pro",
  price = 4.99,
  pricePeriod,
  billingNote,
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [selectedMethod, setSelectedMethod] = useState("card");

  const PAYMENT_METHODS = [
    {
      id: "card",
      name: t("payment.methods.card"),
      icon: "/icons/card.png",
      details: "**** **** **** 3874",
      issuer: "Max Mustermann",
    },
    {
      id: "paypal",
      name: t("payment.methods.paypal"),
      icon: "/icons/paypal.png",
      details: user?.email || t("payment.methods.paypalAccount"),
    },
    {
      id: "apple",
      name: t("payment.methods.apple"),
      icon: "/icons/apple-pay.png",
      details: t("payment.methods.appleCard"),
    },
    {
      id: "google",
      name: t("payment.methods.google"),
      icon: "/icons/google-pay.png",
      details: t("payment.methods.googleAccount"),
    },
  ];

  return (
    <div className="payment-confirm-backdrop" onClick={onClose}>
      <div
        className="payment-confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-confirm-header">
          <h2>{t("payment.title")}</h2>
          <button className="payment-confirm-close" onClick={onClose}>
            {"\u00D7"}
          </button>
        </div>

        <div className="payment-confirm-content">
          <div className="payment-confirm-left">
            <h3 className="payment-methods-title">{t("payment.method")}</h3>

            <div className="payment-methods-list">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.id}
                  className={`payment-method-item ${selectedMethod === method.id ? "active" : ""}`}
                  onClick={() => setSelectedMethod(method.id)}
                >
                  <img
                    src={method.icon}
                    alt={method.name}
                    className="payment-method-item-icon"
                  />
                  <div className="payment-method-item-info">
                    <span className="payment-method-item-name">
                      {method.name}
                    </span>
                    <span className="payment-method-item-detail">
                      {method.details}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <p className="payment-security-note">{t("payment.security")}</p>
          </div>

          <div className="payment-confirm-right">
            <h3 className="plan-info-title">{plan}</h3>
            <p className="plan-info-subtitle">{t("payment.upgradeAccount")}</p>
            <br></br>
            <div className="plan-details">
              <div className="plan-detail-row">
                <span className="plan-detail-label">{t("payment.plan")}</span>
                <span className="plan-detail-value">{plan}</span>
              </div>
              <div className="plan-detail-row">
                <span className="plan-detail-label">
                  {t("payment.duration")}
                </span>
                <span className="plan-detail-value">
                  {t("payment.monthlyCancelable")}
                </span>
              </div>
            </div>

            <div className="plan-price-section">
              <span className="plan-price-amount">${price.toFixed(2)}</span>
              <span className="plan-price-period">
                {pricePeriod || t("payment.perMonth")}
              </span>
              <p className="plan-price-note">
                {billingNote || t("payment.tax")}
              </p>
            </div>

            <button className="payment-confirm-btn" onClick={onConfirm}>
              {t("payment.confirmUpgrade")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
