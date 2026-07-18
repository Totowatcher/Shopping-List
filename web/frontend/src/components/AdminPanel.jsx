import React, { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../apiBase.js";
import { isSessionExpiredError } from "../authApi.js";

export default function AdminPanel({ authFetch, currentUsername }) {
  const [users, setUsers] = useState(null);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl("/admin/users"));
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (e) {
      if (!isSessionExpiredError(e)) console.error(e);
    }
  }, [authFetch]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const createUser = async () => {
    setError("");
    if (!newUser.trim() || !newPass) {
      setError("Username and password are required");
      return;
    }
    try {
      const res = await authFetch(apiUrl("/admin/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUser.trim(),
          password: newPass,
          role: newRole,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to create user");
        return;
      }
      setNewUser("");
      setNewPass("");
      setNewRole("user");
      loadUsers();
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  const deleteUser = async (username) => {
    if (!window.confirm(`Delete user "${username}"?`)) return;
    setError("");
    try {
      const res = await authFetch(apiUrl(`/admin/users/${encodeURIComponent(username)}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to delete user");
      }
      loadUsers();
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  const resetPassword = async (username) => {
    const pw = window.prompt(`New password for "${username}":`);
    if (!pw) return;
    setError("");
    try {
      const res = await authFetch(
        apiUrl(`/admin/users/${encodeURIComponent(username)}/password`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to reset password");
      }
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  if (users === null) {
    return <div className="loading">Loading users…</div>;
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">User Management</div>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>
                <span className={`role-pill ${u.role}`}>{u.role}</span>
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                  className="btn btn-ghost"
                  style={{ marginRight: 8 }}
                  onClick={() => resetPassword(u.username)}
                >
                  Reset password
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => deleteUser(u.username)}
                  disabled={u.username === currentUsername}
                  title={
                    u.username === currentUsername
                      ? "You cannot delete your own account"
                      : undefined
                  }
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin-form">
        <input
          className="admin-input"
          placeholder="Username"
          value={newUser}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setNewUser(e.target.value)}
        />
        <input
          className="admin-input"
          placeholder="Password"
          type="password"
          value={newPass}
          onChange={(e) => setNewPass(e.target.value)}
        />
        <select
          className="admin-select"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button className="btn btn-primary" onClick={createUser}>
          Add user
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
