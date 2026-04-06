import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import "../styles/CookieBanner.css";

// cookie banner: GDPR consent prompt with accept/decline buttons
export default function CookieBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    const cookieConsent = localStorage.getItem("wieland_cookie_consent");
    if (!cookieConsent) {
      setShow(true);
    }
  }, []);

  // handler separat halten, sonst wird die render-logik schnell wirr
  const handleAccept = () => {
    localStorage.setItem("wieland_cookie_consent", "accepted");
    document.cookie =
      "wieland_cookie_consent=accepted; path=/; max-age=31536000";
    window.dispatchEvent(new Event("wieland-cookie-consent-changed"));
    setShow(false);
  };

  // handler separat halten, sonst wird die render-logik schnell wirr
  const handleDecline = () => {
    localStorage.setItem("wieland_cookie_consent", "declined");
    document.cookie =
      "wieland_cookie_consent=declined; path=/; max-age=31536000";
    window.dispatchEvent(new Event("wieland-cookie-consent-changed"));
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="cookie-banner">
      <div className="cookie-banner-content">
        <div className="cookie-banner-text">
          <h3>🍪 {t("cookie.title")}</h3>
          <p>
            {t("cookie.text")}{" "}
            <Link to={t("routes.privacy")} className="cookie-privacy-link">
              {t("footer.privacy")}
            </Link>
          </p>
        </div>
        <div className="cookie-banner-buttons">
          <button
            className="cookie-btn cookie-btn-accept"
            onClick={handleAccept}
          >
            {t("cookie.accept")}
          </button>
          <button
            className="cookie-btn cookie-btn-decline"
            onClick={handleDecline}
          >
            {t("cookie.decline")}
          </button>
        </div>
      </div>
    </div>
  );
}
