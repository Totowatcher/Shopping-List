import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../apiBase.js";
import { isSessionExpiredError } from "../authApi.js";

const ACTIVE_STORE_KEY = "sl_active_store";

export default function ShoppingLists({ authFetch }) {
  const [stores, setStores] = useState(null);
  const [activeStoreId, setActiveStoreId] = useState(() => {
    const saved = Number(localStorage.getItem(ACTIVE_STORE_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const nameInputRef = useRef(null);

  const [editItem, setEditItem] = useState(null);
  const [storeModal, setStoreModal] = useState(null); // {mode:"add"} or {mode:"rename", store}

  const swallow = (e) => {
    if (!isSessionExpiredError(e)) {
      console.error(e);
      setError(e.message || "Something went wrong");
    }
  };

  const loadStores = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl("/stores"));
      if (!res.ok) throw new Error("Failed to load stores");
      const data = await res.json();
      setStores(data.stores);
      return data.stores;
    } catch (e) {
      swallow(e);
      return null;
    }
  }, [authFetch]);

  const loadItems = useCallback(
    async (storeId) => {
      try {
        const res = await authFetch(apiUrl(`/stores/${storeId}/items`));
        if (res.status === 404) {
          setActiveStoreId(null);
          return;
        }
        if (!res.ok) throw new Error("Failed to load items");
        const data = await res.json();
        setItems(data.items);
      } catch (e) {
        swallow(e);
      }
    },
    [authFetch]
  );

  useEffect(() => {
    (async () => {
      const list = await loadStores();
      if (!list) return;
      setActiveStoreId((cur) => {
        if (cur && list.some((s) => s.id === cur)) return cur;
        return list.length > 0 ? list[0].id : null;
      });
    })();
  }, [loadStores]);

  useEffect(() => {
    if (activeStoreId) {
      localStorage.setItem(ACTIVE_STORE_KEY, String(activeStoreId));
      loadItems(activeStoreId);
    } else {
      setItems([]);
    }
  }, [activeStoreId, loadItems]);

  const refresh = useCallback(async () => {
    await loadStores();
    if (activeStoreId) await loadItems(activeStoreId);
  }, [loadStores, loadItems, activeStoreId]);

  const activeStore = stores?.find((s) => s.id === activeStoreId) || null;

  // ------------------------------------------------------------------ items

  const addItem = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || !activeStoreId) return;
    setError("");
    try {
      const res = await authFetch(apiUrl(`/stores/${activeStoreId}/items`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, quantity: newQty.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to add item");
      }
      setNewName("");
      setNewQty("");
      nameInputRef.current?.focus();
      await refresh();
    } catch (e2) {
      swallow(e2);
    }
  };

  const toggleItem = async (item) => {
    setItems((cur) =>
      cur.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i))
    );
    try {
      await authFetch(apiUrl(`/items/${item.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: !item.checked }),
      });
      await refresh();
    } catch (e) {
      swallow(e);
    }
  };

  const deleteItem = async (item) => {
    try {
      await authFetch(apiUrl(`/items/${item.id}`), { method: "DELETE" });
      await refresh();
    } catch (e) {
      swallow(e);
    }
  };

  const saveItemEdit = async () => {
    const it = editItem;
    if (!it || !it.name.trim()) return;
    try {
      await authFetch(apiUrl(`/items/${it.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: it.name,
          quantity: it.quantity,
          note: it.note,
        }),
      });
      setEditItem(null);
      await refresh();
    } catch (e) {
      swallow(e);
    }
  };

  const clearChecked = async () => {
    if (!activeStoreId) return;
    try {
      await authFetch(apiUrl(`/stores/${activeStoreId}/clear-checked`), {
        method: "POST",
      });
      await refresh();
    } catch (e) {
      swallow(e);
    }
  };

  // ----------------------------------------------------------------- stores

  const saveStoreModal = async () => {
    const name = storeModal?.name?.trim();
    if (!name) return;
    try {
      const isAdd = storeModal.mode === "add";
      const res = await authFetch(
        apiUrl(isAdd ? "/stores" : `/stores/${storeModal.store.id}`),
        {
          method: isAdd ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStoreModal((m) => ({ ...m, error: data.detail || "Failed to save" }));
        return;
      }
      setStoreModal(null);
      const list = await loadStores();
      if (isAdd && data.id && list) setActiveStoreId(data.id);
    } catch (e) {
      swallow(e);
    }
  };

  const deleteStore = async () => {
    const store = storeModal?.store;
    if (!store) return;
    if (
      !window.confirm(
        `Delete "${store.name}" and everything on its list? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await authFetch(apiUrl(`/stores/${store.id}`), { method: "DELETE" });
      setStoreModal(null);
      const list = await loadStores();
      if (list) setActiveStoreId(list.length > 0 ? list[0].id : null);
    } catch (e) {
      swallow(e);
    }
  };

  // ------------------------------------------------------------------ render

  if (stores === null) {
    return <div className="loading">Loading your lists…</div>;
  }

  const openItems = items.filter((i) => !i.checked);
  const doneItems = items.filter((i) => i.checked);

  return (
    <>
      {error && <div className="form-error">{error}</div>}

      <div className="store-bar">
        {stores.map((s) => (
          <button
            key={s.id}
            className={`store-chip ${s.id === activeStoreId ? "active" : ""}`}
            onClick={() => setActiveStoreId(s.id)}
          >
            {s.name}
            {s.open_count > 0 && <span className="badge">{s.open_count}</span>}
          </button>
        ))}
        <button
          className="store-chip add"
          onClick={() => setStoreModal({ mode: "add", name: "" })}
        >
          + Add store
        </button>
      </div>

      {activeStore ? (
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">{activeStore.name}</div>
            <div className="panel-actions">
              <button
                className="btn btn-ghost"
                onClick={() =>
                  setStoreModal({
                    mode: "rename",
                    store: activeStore,
                    name: activeStore.name,
                  })
                }
              >
                Edit store
              </button>
              <button
                className="btn btn-ghost"
                onClick={clearChecked}
                disabled={doneItems.length === 0}
              >
                Clear done ({doneItems.length})
              </button>
            </div>
          </div>

          <form className="add-form" onSubmit={addItem}>
            <input
              ref={nameInputRef}
              className="add-input"
              placeholder="Add an item…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoCapitalize="sentences"
            />
            <input
              className="add-input"
              placeholder="Qty"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={!newName.trim()}>
              Add
            </button>
          </form>

          {items.length === 0 ? (
            <div className="empty-note">
              <div className="big" role="img" aria-label="basket">
                &#129530;
              </div>
              Nothing on the {activeStore.name} list yet.
            </div>
          ) : (
            <ul className="item-list">
              {openItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={toggleItem}
                  onDelete={deleteItem}
                  onEdit={() => setEditItem({ ...item })}
                />
              ))}
              {doneItems.length > 0 && (
                <li className="done-divider">In the cart</li>
              )}
              {doneItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={toggleItem}
                  onDelete={deleteItem}
                  onEdit={() => setEditItem({ ...item })}
                />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="panel">
          <div className="empty-note">
            <div className="big" role="img" aria-label="store">
              &#127978;
            </div>
            No stores yet. Add one to start your first list.
          </div>
        </div>
      )}

      {editItem && (
        <div className="modal-backdrop" onClick={() => setEditItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Edit item</div>
            <label className="modal-label">Item</label>
            <input
              className="modal-input"
              value={editItem.name}
              onChange={(e) => setEditItem({ ...editItem, name: e.target.value })}
              autoFocus
            />
            <label className="modal-label">Quantity</label>
            <input
              className="modal-input"
              value={editItem.quantity}
              onChange={(e) =>
                setEditItem({ ...editItem, quantity: e.target.value })
              }
              placeholder="e.g. 2, 1 lb, a dozen"
            />
            <label className="modal-label">Note</label>
            <input
              className="modal-input"
              value={editItem.note}
              onChange={(e) => setEditItem({ ...editItem, note: e.target.value })}
              placeholder="e.g. brand, aisle, ripe ones"
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditItem(null)}>
                Cancel
              </button>
              <span className="spacer" />
              <button
                className="btn btn-primary"
                onClick={saveItemEdit}
                disabled={!editItem.name.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {storeModal && (
        <div className="modal-backdrop" onClick={() => setStoreModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              {storeModal.mode === "add" ? "Add a store" : "Edit store"}
            </div>
            <label className="modal-label">Store name</label>
            <input
              className="modal-input"
              value={storeModal.name}
              onChange={(e) =>
                setStoreModal({ ...storeModal, name: e.target.value, error: "" })
              }
              placeholder="e.g. Costco, Kroger, Home Depot"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveStoreModal();
              }}
            />
            {storeModal.error && (
              <div className="form-error" style={{ padding: "0 0 10px" }}>
                {storeModal.error}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setStoreModal(null)}>
                Cancel
              </button>
              {storeModal.mode === "rename" && (
                <button className="btn btn-danger" onClick={deleteStore}>
                  Delete store
                </button>
              )}
              <span className="spacer" />
              <button
                className="btn btn-primary"
                onClick={saveStoreModal}
                disabled={!storeModal.name.trim()}
              >
                {storeModal.mode === "add" ? "Add" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ItemRow({ item, onToggle, onDelete, onEdit }) {
  const meta = [item.quantity, item.note].filter(Boolean);
  return (
    <li className={`item-row ${item.checked ? "checked" : ""}`}>
      <button
        className="item-check"
        onClick={() => onToggle(item)}
        aria-label={item.checked ? "Mark as needed" : "Mark as in cart"}
      >
        &#10003;
      </button>
      <div className="item-body" onClick={onEdit}>
        <div className="item-name">{item.name}</div>
        {meta.length > 0 && (
          <div className="item-meta">
            {item.quantity && <span className="item-qty">{item.quantity}</span>}
            {item.quantity && item.note && " · "}
            {item.note}
          </div>
        )}
      </div>
      <button
        className="item-del"
        onClick={() => onDelete(item)}
        aria-label="Delete item"
      >
        &#215;
      </button>
    </li>
  );
}
