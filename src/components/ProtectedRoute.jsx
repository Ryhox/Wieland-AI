import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { withLang } from "../utils/i18nRouting";

// protected route: guard routes behind authentication + optional plan requirement
export default function ProtectedRoute({ children, requiredPlan = null }) {
  const { t, i18n } = useTranslation();
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "rgba(255,255,255,0.6)",
          fontSize: 14,
          background: "#0a0b0f",
        }}
      >
        {t("protectedRoute.loading")}
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to={withLang("/", i18n.language)}
        state={{ from: location }}
        replace
      />
    );
  }

  if (requiredPlan && user.plan !== requiredPlan) {
    return (
      <Navigate
        to={withLang("/", i18n.language)}
        state={{ from: location }}
        replace
      />
    );
  }

  return children;
}
