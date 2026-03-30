import "../styles/LoadingAnimation.css";
import { useTranslation } from "react-i18next";

export default function LoadingAnimation({ isVisible }) {
  const { t } = useTranslation();
  return (
    <div className={`loading-overlay ${!isVisible ? "hidden" : ""}`}>
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p className="loading-text">{t("loadingAnimation.text")}</p>
      </div>
    </div>
  );
}
