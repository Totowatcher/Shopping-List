import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createAuthFetch, isSessionExpiredError } from "./authApi.js";
import { apiUrl } from "./apiBase.js";
import LoginForm from "./components/LoginForm.jsx";
import ShoppingLists from "./components/ShoppingLists.jsx";
import AdminPanel from "./components/AdminPanel.jsx";

const TOKEN_KEY = "sl_access_token";
const USER_KEY = "sl_user";

function loadSavedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export default function App() {
  const [accessToken, setAccessToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || ""
  );
  const [user, setUser] = useState(loadSavedUser);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [view, setView] = useState("lists");

  const handleSessionExpired = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAccessToken("");
    setUser(null);
    setSessionExpired(true);
  }, []);

  const authFetch = useMemo(
    () => createAuthFetch(() => accessToken, handleSessionExpired),
    [accessToken, handleSessionExpired]
  );

  // Validate the saved token on startup so a stale login shows the form again.
  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      try {
        const res = await authFetch(apiUrl("/auth/me"));
        if (res.ok) {
          const me = await res.json();
          setUser(me);
          localStorage.setItem(USER_KEY, JSON.stringify(me));
        }
      } catch (e) {
        if (!isSessionExpiredError(e)) console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (token, username, role) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify({ username, role }));
    setAccessToken(token);
    setUser({ username, role });
    setSessionExpired(false);
    setView("lists");
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAccessToken("");
    setUser(null);
    setSessionExpired(false);
  };

  if (!accessToken || !user) {
    return (
      <>
        {sessionExpired && (
          <div className="session-banner">
            Your session expired. Please sign in again.
          </div>
        )}
        <LoginForm onLogin={handleLogin} />
      </>
    );
  }

  return (
    <div className="app">
      <header className="navbar">
        <div className="brand">
          <span role="img" aria-label="cart">
            &#128722;
          </span>
          Shopping List
        </div>
        <div className="nav-right">
          {user.role === "admin" && (
            <button
              className={`nav-btn ${view === "admin" ? "active" : ""}`}
              onClick={() => setView(view === "admin" ? "lists" : "admin")}
            >
              {view === "admin" ? "Lists" : "Admin"}
            </button>
          )}
          <span className="nav-user">{user.username}</span>
          <button className="nav-btn" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">
        {view === "admin" && user.role === "admin" ? (
          <AdminPanel authFetch={authFetch} currentUsername={user.username} />
        ) : (
          <ShoppingLists authFetch={authFetch} />
        )}
      </main>
    </div>
  );
}
