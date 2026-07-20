import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const nameInputRef = useRef(null);
  const suggestTimer = useRef(null);

  const [editItem, setEditItem] = useState(null);
  const [storeModal, setStoreModal] = useState(null); // {mode:"add"} or {mode:"rename", store, categories, ...}
  const [dragId, setDragId] = useState(null);
  const [catDragId, setCatDragId] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
        setCategories(data.categories || []);
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
      setNewCategoryId("");
    } else {
      setItems([]);
      setCategories([]);
    }
  }, [activeStoreId, loadItems]);

  const refresh = useCallback(async () => {
    await loadStores();
    if (activeStoreId) await loadItems(activeStoreId);
  }, [loadStores, loadItems, activeStoreId]);

  // Keep the list in sync with other devices: refetch when the app comes back
  // to the foreground, and poll while it stays visible. Paused during a drag
  // or while a modal is open so a refetch doesn't disturb what the user is doing.
  useEffect(() => {
    if (
      dragId !== null ||
      catDragId !== null ||
      editItem !== null ||
      storeModal !== null
    ) {
      return;
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    const timer = setInterval(refreshIfVisible, 12000);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
      clearInterval(timer);
    };
  }, [refresh, dragId, catDragId, editItem, storeModal]);

  // Suggest a category as the user types an item name
  useEffect(() => {
    if (!activeStoreId || !newName.trim() || categories.length === 0) return;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await authFetch(
          apiUrl(
            `/stores/${activeStoreId}/suggest-category?name=${encodeURIComponent(newName.trim())}`
          )
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.category_id) {
          setNewCategoryId(String(data.category_id));
        }
      } catch {
        // ignore suggest failures
      }
    }, 300);
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [newName, activeStoreId, categories.length, authFetch]);

  const activeStore = stores?.find((s) => s.id === activeStoreId) || null;

  const openItems = useMemo(() => items.filter((i) => !i.checked), [items]);
  const doneItems = useMemo(() => items.filter((i) => i.checked), [items]);

  // Group open items by category sort order; uncategorized last
  const openGroups = useMemo(() => {
    const byCat = new Map();
    for (const item of openItems) {
      const key = item.category_id ?? null;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(item);
    }
    const groups = [];
    for (const cat of categories) {
      const list = byCat.get(cat.id);
      if (list && list.length > 0) {
        groups.push({ key: cat.id, label: cat.name, items: list });
      }
      byCat.delete(cat.id);
    }
    // Uncategorized + any orphaned category_ids
    const uncategorized = byCat.get(null) || [];
    byCat.delete(null);
    for (const [, list] of byCat) {
      uncategorized.push(...list);
    }
    if (uncategorized.length > 0) {
      groups.push({
        key: null,
        label: categories.length > 0 ? "Uncategorized" : null,
        items: uncategorized,
      });
    }
    return groups;
  }, [openItems, categories]);

  // ------------------------------------------------------------------ items

  const addItem = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || !activeStoreId) return;
    setError("");
    const body = { name, quantity: newQty.trim() };
    if (newCategoryId) body.category_id = Number(newCategoryId);
    try {
      const res = await authFetch(apiUrl(`/stores/${activeStoreId}/items`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to add item");
      }
      setNewName("");
      setNewQty("");
      // keep category selection for rapid entry of similar items
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
          category_id: it.category_id || null,
        }),
      });
      setEditItem(null);
      await refresh();
    } catch (e) {
      swallow(e);
    }
  };

  const startDrag = (e, item) => {
    e.preventDefault();
    setDragId(item.id);

    const onMove = (ev) => {
      const el = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-item-id]");
      if (!el) return;
      const overId = Number(el.dataset.itemId);
      if (!overId || overId === item.id) return;
      setItems((cur) => {
        const from = cur.findIndex((i) => i.id === item.id);
        const to = cur.findIndex((i) => i.id === overId);
        if (from < 0 || to < 0 || cur[to].checked) return cur;
        // When dropping onto an item in another category, adopt that category
        const next = [...cur];
        const [moved] = next.splice(from, 1);
        const over = next[to > from ? to - 1 : to];
        if (over && !over.checked) {
          moved.category_id = over.category_id;
        }
        next.splice(to, 0, moved);
        return next;
      });
    };

    const onEnd = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      setDragId(null);
      const ordered = itemsRef.current;
      const moved = ordered.find((i) => i.id === item.id);
      const ids = [
        ...ordered.filter((i) => !i.checked),
        ...ordered.filter((i) => i.checked),
      ].map((i) => i.id);
      try {
        if (moved && moved.category_id !== item.category_id) {
          await authFetch(apiUrl(`/items/${item.id}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category_id: moved.category_id ?? null }),
          });
        }
        await authFetch(apiUrl(`/stores/${item.store_id}/reorder`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_ids: ids }),
        });
      } catch (e2) {
        swallow(e2);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
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

  const openEditStore = async () => {
    if (!activeStore) return;
    let cats = categories;
    try {
      const res = await authFetch(apiUrl(`/stores/${activeStore.id}/categories`));
      if (res.ok) {
        const data = await res.json();
        cats = data.categories || [];
      }
    } catch {
      // use current
    }
    setStoreModal({
      mode: "rename",
      store: activeStore,
      name: activeStore.name,
      categories: cats.map((c) => ({ ...c })),
      newCatName: "",
      catError: "",
    });
  };

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
      else if (activeStoreId) await loadItems(activeStoreId);
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

  // ---------------------------------------------------------- categories UI

  const addCategoryInModal = async () => {
    const name = storeModal?.newCatName?.trim();
    if (!name || !storeModal?.store) return;
    try {
      const res = await authFetch(
        apiUrl(`/stores/${storeModal.store.id}/categories`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStoreModal((m) => ({
          ...m,
          catError: data.detail || "Failed to add category",
        }));
        return;
      }
      const listRes = await authFetch(
        apiUrl(`/stores/${storeModal.store.id}/categories`)
      );
      const listData = await listRes.json();
      setStoreModal((m) => ({
        ...m,
        categories: listData.categories || [],
        newCatName: "",
        catError: "",
      }));
      setCategories(listData.categories || []);
    } catch (e) {
      swallow(e);
    }
  };

  const renameCategoryInModal = async (cat, newName) => {
    const name = newName.trim();
    if (!name || name === cat.name) return;
    try {
      const res = await authFetch(apiUrl(`/categories/${cat.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStoreModal((m) => ({
          ...m,
          catError: data.detail || "Failed to rename",
        }));
        return;
      }
      setStoreModal((m) => ({
        ...m,
        categories: m.categories.map((c) =>
          c.id === cat.id ? { ...c, name } : c
        ),
        catError: "",
      }));
      setCategories((cur) =>
        cur.map((c) => (c.id === cat.id ? { ...c, name } : c))
      );
    } catch (e) {
      swallow(e);
    }
  };

  const deleteCategoryInModal = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}"? Items keep their place as uncategorized.`)) {
      return;
    }
    try {
      await authFetch(apiUrl(`/categories/${cat.id}`), { method: "DELETE" });
      setStoreModal((m) => ({
        ...m,
        categories: m.categories.filter((c) => c.id !== cat.id),
      }));
      setCategories((cur) => cur.filter((c) => c.id !== cat.id));
      if (activeStoreId) await loadItems(activeStoreId);
    } catch (e) {
      swallow(e);
    }
  };

  const seedGroceryDefaults = async () => {
    if (!storeModal?.store) return;
    try {
      const res = await authFetch(
        apiUrl(`/stores/${storeModal.store.id}/categories/grocery-defaults`),
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStoreModal((m) => ({
          ...m,
          catError: data.detail || "Failed to add defaults",
        }));
        return;
      }
      setStoreModal((m) => ({
        ...m,
        categories: data.categories || [],
        catError: "",
      }));
      setCategories(data.categories || []);
    } catch (e) {
      swallow(e);
    }
  };

  const startCategoryDrag = (e, cat) => {
    e.preventDefault();
    if (!storeModal) return;
    setCatDragId(cat.id);

    const onMove = (ev) => {
      const el = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-cat-id]");
      if (!el) return;
      const overId = Number(el.dataset.catId);
      if (!overId || overId === cat.id) return;
      setStoreModal((m) => {
        if (!m) return m;
        const list = [...m.categories];
        const from = list.findIndex((c) => c.id === cat.id);
        const to = list.findIndex((c) => c.id === overId);
        if (from < 0 || to < 0) return m;
        const next = [...list];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return { ...m, categories: next };
      });
    };

    const onEnd = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      setCatDragId(null);
      setStoreModal((m) => {
        if (!m) return m;
        const ids = m.categories.map((c) => c.id);
        authFetch(apiUrl(`/stores/${m.store.id}/categories/reorder`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_ids: ids }),
        })
          .then(() => {
            setCategories(m.categories);
          })
          .catch(swallow);
        return m;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  // ------------------------------------------------------------------ render

  if (stores === null) {
    return <div className="loading">Loading your lists…</div>;
  }

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
              <button className="btn btn-ghost" onClick={openEditStore}>
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
            {categories.length > 0 && (
              <select
                className="add-select"
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
                aria-label="Category"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
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
              {openGroups.map((group) => (
                <React.Fragment key={group.key ?? "none"}>
                  {group.label && (
                    <li className="category-header">{group.label}</li>
                  )}
                  {group.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      dragging={item.id === dragId}
                      onDragStart={startDrag}
                      onToggle={toggleItem}
                      onDelete={deleteItem}
                      onEdit={() => setEditItem({ ...item })}
                    />
                  ))}
                </React.Fragment>
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
            {categories.length > 0 && (
              <>
                <label className="modal-label">Category</label>
                <select
                  className="modal-input"
                  value={editItem.category_id ?? ""}
                  onChange={(e) =>
                    setEditItem({
                      ...editItem,
                      category_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            )}
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
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
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
              autoFocus={storeModal.mode === "add"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && storeModal.mode === "add") saveStoreModal();
              }}
            />
            {storeModal.error && (
              <div className="form-error" style={{ padding: "0 0 10px" }}>
                {storeModal.error}
              </div>
            )}

            {storeModal.mode === "rename" && (
              <div className="cat-manage">
                <div className="cat-manage-head">
                  <span className="modal-label" style={{ marginBottom: 0 }}>
                    Categories (shopping order)
                  </span>
                  {(!storeModal.categories || storeModal.categories.length === 0) && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={seedGroceryDefaults}
                    >
                      Add grocery defaults
                    </button>
                  )}
                </div>
                <ul className="cat-list">
                  {(storeModal.categories || []).map((cat) => (
                    <li
                      key={cat.id}
                      className={`cat-row ${catDragId === cat.id ? "dragging" : ""}`}
                      data-cat-id={cat.id}
                    >
                      <span
                        className="item-handle"
                        onPointerDown={(e) => startCategoryDrag(e, cat)}
                        aria-label="Drag to reorder"
                      >
                        &#8801;
                      </span>
                      <input
                        className="cat-name-input"
                        defaultValue={cat.name}
                        onBlur={(e) => renameCategoryInModal(cat, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.target.blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="item-del"
                        onClick={() => deleteCategoryInModal(cat)}
                        aria-label="Delete category"
                      >
                        &#215;
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="cat-add-row">
                  <input
                    className="modal-input"
                    style={{ marginBottom: 0 }}
                    placeholder="New category…"
                    value={storeModal.newCatName || ""}
                    onChange={(e) =>
                      setStoreModal({
                        ...storeModal,
                        newCatName: e.target.value,
                        catError: "",
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCategoryInModal();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={addCategoryInModal}
                    disabled={!storeModal.newCatName?.trim()}
                  >
                    Add
                  </button>
                </div>
                {storeModal.catError && (
                  <div className="form-error" style={{ padding: "8px 0 0" }}>
                    {storeModal.catError}
                  </div>
                )}
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

function ItemRow({ item, dragging, onDragStart, onToggle, onDelete, onEdit }) {
  const meta = [item.quantity, item.note].filter(Boolean);
  return (
    <li
      className={`item-row ${item.checked ? "checked" : ""} ${dragging ? "dragging" : ""}`}
      data-item-id={item.id}
    >
      {onDragStart && (
        <span
          className="item-handle"
          onPointerDown={(e) => onDragStart(e, item)}
          aria-label="Drag to reorder"
        >
          &#8801;
        </span>
      )}
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
