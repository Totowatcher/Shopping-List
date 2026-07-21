import React, { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../apiBase.js";
import { isSessionExpiredError } from "../authApi.js";

export default function AdminPanel({ authFetch, currentUsername }) {
  const [users, setUsers] = useState(null);
  const [groups, setGroups] = useState([]);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newUserGroup, setNewUserGroup] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [uRes, gRes] = await Promise.all([
        authFetch(apiUrl("/admin/users")),
        authFetch(apiUrl("/admin/groups")),
      ]);
      if (uRes.ok) {
        const data = await uRes.json();
        setUsers(data.users || []);
      }
      if (gRes.ok) {
        const data = await gRes.json();
        const list = data.groups || [];
        setGroups(list);
        setNewUserGroup((cur) => cur || (list[0] ? String(list[0].id) : ""));
      }
    } catch (e) {
      if (!isSessionExpiredError(e)) console.error(e);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const createUser = async () => {
    setError("");
    if (!newUser.trim() || !newPass) {
      setError("Username and password are required");
      return;
    }
    if (!newUserGroup) {
      setError("Choose a group for the new user");
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
          group_id: Number(newUserGroup),
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
      load();
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  const deleteUser = async (username) => {
    if (!window.confirm(`Delete user "${username}"?`)) return;
    setError("");
    try {
      const res = await authFetch(
        apiUrl(`/admin/users/${encodeURIComponent(username)}`),
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to delete user");
      }
      load();
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

  const setUserGroup = async (username, groupId) => {
    setError("");
    try {
      const res = await authFetch(
        apiUrl(`/admin/users/${encodeURIComponent(username)}/group`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group_id: Number(groupId) }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to move user");
        return;
      }
      load();
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  const createGroup = async () => {
    setError("");
    const name = newGroupName.trim();
    if (!name) {
      setError("Group name required");
      return;
    }
    try {
      const res = await authFetch(apiUrl("/admin/groups"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to create group");
        return;
      }
      setNewGroupName("");
      load();
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  const renameGroup = async (group) => {
    const name = window.prompt("Rename group:", group.name);
    if (!name || !name.trim() || name.trim() === group.name) return;
    setError("");
    try {
      const res = await authFetch(apiUrl(`/admin/groups/${group.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to rename group");
        return;
      }
      load();
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  const deleteGroup = async (group) => {
    if (
      !window.confirm(
        `Delete group "${group.name}"? It must have no users and no stores.`
      )
    ) {
      return;
    }
    setError("");
    try {
      const res = await authFetch(apiUrl(`/admin/groups/${group.id}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to delete group");
        return;
      }
      load();
    } catch (e) {
      if (!isSessionExpiredError(e)) setError(e.message);
    }
  };

  if (users === null) {
    return <div className="loading">Loading users…</div>;
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div className="panel-title">Groups</div>
        </div>
        <p className="admin-hint">
          Each group has its own stores and shopping lists. Users only see lists
          for the group they belong to.
        </p>
        <ul className="admin-card-list">
          {groups.map((g) => (
            <li key={g.id} className="admin-card">
              <div className="admin-card-main">
                <div className="admin-card-title">{g.name}</div>
                <div className="admin-card-meta">
                  {g.user_count} user{g.user_count === 1 ? "" : "s"} ·{" "}
                  {g.store_count} store{g.store_count === 1 ? "" : "s"}
                </div>
              </div>
              <div className="admin-card-actions">
                <button className="btn btn-ghost" onClick={() => renameGroup(g)}>
                  Rename
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => deleteGroup(g)}
                  disabled={g.user_count > 0 || g.store_count > 0}
                  title={
                    g.user_count > 0 || g.store_count > 0
                      ? "Move users and delete stores first"
                      : undefined
                  }
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="admin-form">
          <input
            className="admin-input"
            placeholder="New group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createGroup();
            }}
          />
          <button
            className="btn btn-primary"
            onClick={createGroup}
            disabled={!newGroupName.trim()}
          >
            Add group
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Users</div>
        </div>

        <ul className="admin-card-list">
          {users.map((u) => (
            <li key={u.username} className="admin-card">
              <div className="admin-card-main">
                <div className="admin-card-title">
                  {u.username}{" "}
                  <span className={`role-pill ${u.role}`}>{u.role}</span>
                </div>
                <label className="admin-card-meta admin-group-label">
                  Group
                  <select
                    className="admin-select"
                    value={u.group_id ?? ""}
                    onChange={(e) => setUserGroup(u.username, e.target.value)}
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="admin-card-actions">
                <button
                  className="btn btn-ghost"
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
              </div>
            </li>
          ))}
        </ul>

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
          <select
            className="admin-select"
            value={newUserGroup}
            onChange={(e) => setNewUserGroup(e.target.value)}
            aria-label="Group"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={createUser}>
            Add user
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </>
  );
}
