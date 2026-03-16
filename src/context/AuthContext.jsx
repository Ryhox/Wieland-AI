import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'wieland_token';
const USER_KEY  = 'wieland_user';

function setCookie(name, value, days = 365) {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
  const nameEQ = `${name}=`;
  const cookies = document.cookie.split(';');
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

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  });
  const [token,   setToken]   = useState(() => 
    localStorage.getItem(TOKEN_KEY) || getCookie(TOKEN_KEY)
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY) || getCookie(TOKEN_KEY);
    if (!storedToken) { setLoading(false); return; }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        setUser(data.user);
        setToken(storedToken);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        setCookie(TOKEN_KEY, storedToken);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        deleteCookie(TOKEN_KEY);
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((newToken, newUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setCookie(TOKEN_KEY, newToken);
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
    const tok = localStorage.getItem(TOKEN_KEY) || getCookie(TOKEN_KEY);
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    return fetch(url, { ...options, headers });
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, authFetch, setUser: updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
