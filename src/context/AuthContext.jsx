import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "wieland_token";
const USER_KEY = "wieland_user";
const COOKIE_CONSENT_KEY = "wieland_cookie_consent";

// hier läuft der hauptflow zusammen damit man den zustand schnell greifen kann :)
function setCookie(name, value, days = 365) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
  const nameEQ = `${name}=`;
  const cookies = document.cookie.split(";");
  for (let cookie of cookies) {
    cookie = cookie.trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length));
    }
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
}

function hasCookieConsent() {
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

function isInvalidAuthStatus(status) {
  return status === 401 || status === 403;
}

function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  deleteCookie(TOKEN_KEY);
}

// auth provider: manage user auth state + token persistence + cookie consent
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(
    () =>
      localStorage.getItem(TOKEN_KEY) ||
      (hasCookieConsent() ? getCookie(TOKEN_KEY) : null),
  );
  const [cookieConsentAccepted, setCookieConsentAccepted] = useState(() =>
    hasCookieConsent(),
  );
  const [loading, setLoading] = useState(true);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    const syncConsent = () => setCookieConsentAccepted(hasCookieConsent());
    window.addEventListener("storage", syncConsent);
    window.addEventListener("wieland-cookie-consent-changed", syncConsent);
    return () => {
      window.removeEventListener("storage", syncConsent);
      window.removeEventListener("wieland-cookie-consent-changed", syncConsent);
    };
  }, []);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    if (!token || !cookieConsentAccepted) {
      deleteCookie(TOKEN_KEY);
      return;
    }
    setCookie(TOKEN_KEY, token);
  }, [token, cookieConsentAccepted]);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    const storedToken =
      localStorage.getItem(TOKEN_KEY) ||
      (hasCookieConsent() ? getCookie(TOKEN_KEY) : null);
    if (!storedToken) {
      setLoading(false);
      return;
    }

    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (r) => {
        if (r.ok) return { kind: "ok", data: await r.json() };
        if (isInvalidAuthStatus(r.status)) return { kind: "invalid" };
        throw new Error(`Transient auth check failure (${r.status})`);
      })
      .then((data) => {
        if (data.kind === "invalid") {
          clearStoredAuth();
          setUser(null);
          setToken(null);
          return;
        }

        setUser(data.data.user);
        setToken(storedToken);
        localStorage.setItem(USER_KEY, JSON.stringify(data.data.user));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncAuthFromSources = async () => {
      const localToken = localStorage.getItem(TOKEN_KEY);
      const cookieToken = hasCookieConsent() ? getCookie(TOKEN_KEY) : null;
      const nextToken = localToken || cookieToken;

      if (!nextToken) {
        if (token || user) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          deleteCookie(TOKEN_KEY);
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
        }
        return;
      }

      if (nextToken === token && user) return;

      try {
        const response = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${nextToken}` },
        });

        if (response.ok) {
          const data = await response.json();
          localStorage.setItem(TOKEN_KEY, nextToken);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));

          if (!cancelled) {
            setToken(nextToken);
            setUser(data.user);
          }
          return;
        }

        if (!isInvalidAuthStatus(response.status)) {
          return;
        }

        clearStoredAuth();
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      } catch {}
    };

    syncAuthFromSources();
    const interval = setInterval(syncAuthFromSources, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, user]);

  const login = useCallback((newToken, newUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    deleteCookie(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((newUser) => {
    setUser(newUser);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
  }, []);

  const authFetch = useCallback((url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    const tok =
      localStorage.getItem(TOKEN_KEY) ||
      (hasCookieConsent() ? getCookie(TOKEN_KEY) : null);
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    return fetch(url, { ...options, headers });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        authFetch,
        setUser: updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// use auth: hook für zugriff auf user, token, login/logout + authFetch helpers
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
