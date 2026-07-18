import React, { useState } from "react";
import { apiUrl } from "../apiBase.js";

export default function LoginForm({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Login failed");
      }
      const data = await res.json();
      onLogin(data.access_token, data.username, data.role);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo" role="img" aria-label="cart">
          &#128722;
        </div>
        <div className="login-title">Shopping List</div>
        <div className="login-subtitle">Sign in to see your lists</div>
        {error && <div className="login-error">{error}</div>}
        <label className="login-label" htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          className="login-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          autoFocus
        />
        <label className="login-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
