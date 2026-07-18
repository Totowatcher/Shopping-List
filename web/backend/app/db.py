import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DATABASE_PATH


def _connect() -> sqlite3.Connection:
    Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL CHECK (role IN ('admin', 'user'))
            );

            CREATE TABLE IF NOT EXISTS stores (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                quantity   TEXT NOT NULL DEFAULT '',
                note       TEXT NOT NULL DEFAULT '',
                checked    INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_by TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                checked_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_items_store ON items(store_id);
            """
        )
        _migrate_items_sort_order(conn)


def _migrate_items_sort_order(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(items)")}
    if "sort_order" not in cols:
        conn.execute(
            "ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
        )
        conn.execute("UPDATE items SET sort_order = id")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def count_users() -> int:
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()
        return int(row["n"]) if row else 0


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        return dict(row) if row else None


def insert_user(username: str, password_hash: str, role: str) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, password_hash, role),
        )
        return int(cur.lastrowid)


def list_users() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            "SELECT id, username, role FROM users ORDER BY username COLLATE NOCASE"
        )
        return [dict(row) for row in cur]


def delete_user(username: str) -> int:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        return cur.rowcount


def update_user_password(username: str, password_hash: str) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (password_hash, username),
        )
        return cur.rowcount


# ---------------------------------------------------------------------------
# Stores
# ---------------------------------------------------------------------------

def list_stores() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            """
            SELECT s.id, s.name,
                   COALESCE(SUM(CASE WHEN i.checked = 0 THEN 1 ELSE 0 END), 0) AS open_count,
                   COUNT(i.id) AS item_count
            FROM stores s
            LEFT JOIN items i ON i.store_id = s.id
            GROUP BY s.id
            ORDER BY s.name COLLATE NOCASE
            """
        )
        return [dict(row) for row in cur]


def get_store(store_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name FROM stores WHERE id = ?", (store_id,)
        ).fetchone()
        return dict(row) if row else None


def create_store(name: str) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO stores (name, created_at) VALUES (?, ?)", (name, _now())
        )
        return int(cur.lastrowid)


def rename_store(store_id: int, name: str) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE stores SET name = ? WHERE id = ?", (name, store_id)
        )
        return cur.rowcount


def delete_store(store_id: int) -> int:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM stores WHERE id = ?", (store_id,))
        return cur.rowcount


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

def list_items(store_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            """
            SELECT id, store_id, name, quantity, note, checked, created_by, created_at, checked_at
            FROM items
            WHERE store_id = ?
            ORDER BY checked ASC, sort_order ASC, id ASC
            """,
            (store_id,),
        )
        rows = [dict(row) for row in cur]
        for r in rows:
            r["checked"] = bool(r["checked"])
        return rows


def get_item(item_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM items WHERE id = ?", (item_id,)
        ).fetchone()
        return dict(row) if row else None


def create_item(
    store_id: int, name: str, quantity: str, note: str, created_by: str
) -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM items WHERE store_id = ?",
            (store_id,),
        ).fetchone()
        cur = conn.execute(
            """
            INSERT INTO items (store_id, name, quantity, note, sort_order, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (store_id, name, quantity, note, int(row["next"]), created_by, _now()),
        )
        return int(cur.lastrowid)


def reorder_items(store_id: int, item_ids: List[int]) -> None:
    with get_db() as conn:
        for pos, item_id in enumerate(item_ids, start=1):
            conn.execute(
                "UPDATE items SET sort_order = ? WHERE id = ? AND store_id = ?",
                (pos, item_id, store_id),
            )


def update_item(
    item_id: int,
    name: Optional[str] = None,
    quantity: Optional[str] = None,
    note: Optional[str] = None,
    checked: Optional[bool] = None,
) -> int:
    sets: List[str] = []
    params: List[Any] = []
    if name is not None:
        sets.append("name = ?")
        params.append(name)
    if quantity is not None:
        sets.append("quantity = ?")
        params.append(quantity)
    if note is not None:
        sets.append("note = ?")
        params.append(note)
    if checked is not None:
        sets.append("checked = ?")
        params.append(1 if checked else 0)
        sets.append("checked_at = ?")
        params.append(_now() if checked else None)
    if not sets:
        return 0
    params.append(item_id)
    with get_db() as conn:
        cur = conn.execute(
            f"UPDATE items SET {', '.join(sets)} WHERE id = ?", params
        )
        return cur.rowcount


def delete_item(item_id: int) -> int:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        return cur.rowcount


def clear_checked_items(store_id: int) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM items WHERE store_id = ? AND checked = 1", (store_id,)
        )
        return cur.rowcount
