import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DATABASE_PATH

# Keyword -> family label. Matched against store category names (partial, case-insensitive).
GROCERY_KEYWORD_HINTS: Dict[str, str] = {
    # Pharmacy
    "omeprazole": "pharmacy",
    "ibuprofen": "pharmacy",
    "advil": "pharmacy",
    "tylenol": "pharmacy",
    "aspirin": "pharmacy",
    "band-aid": "pharmacy",
    "bandaid": "pharmacy",
    "vitamin": "pharmacy",
    "prescription": "pharmacy",
    "allergy": "pharmacy",
    "cough": "pharmacy",
    "toothpaste": "pharmacy",
    "shampoo": "pharmacy",
    "deodorant": "pharmacy",
    # Produce
    "banana": "fruit",
    "apple": "fruit",
    "orange": "fruit",
    "grape": "fruit",
    "berry": "fruit",
    "strawberry": "fruit",
    "blueberry": "fruit",
    "lettuce": "vegetable",
    "spinach": "vegetable",
    "tomato": "vegetable",
    "onion": "vegetable",
    "potato": "vegetable",
    "carrot": "vegetable",
    "broccoli": "vegetable",
    "cucumber": "vegetable",
    "avocado": "vegetable",
    "celery": "vegetable",
    "pepper": "vegetable",
    "salad": "vegetable",
    "fruit": "fruit",
    "vegetable": "vegetable",
    # Frozen
    "ice cream": "frozen",
    "frozen": "frozen",
    "pizza": "frozen",
    "popsicle": "frozen",
    "waffle": "frozen",
    # Refrigerated
    "milk": "refrigerat",
    "yogurt": "refrigerat",
    "butter": "refrigerat",
    "cheese": "refrigerat",
    "cream": "refrigerat",
    "egg": "refrigerat",
    "eggs": "refrigerat",
    "juice": "refrigerat",
    "deli": "refrigerat",
    "bacon": "refrigerat",
    "sausage": "refrigerat",
    "ham": "refrigerat",
    "chicken": "refrigerat",
    "beef": "refrigerat",
    "turkey": "refrigerat",
    "fish": "refrigerat",
    "salmon": "refrigerat",
    # Non-frozen / pantry
    "bread": "non-frozen",
    "cereal": "non-frozen",
    "pasta": "non-frozen",
    "rice": "non-frozen",
    "flour": "non-frozen",
    "sugar": "non-frozen",
    "oil": "non-frozen",
    "sauce": "non-frozen",
    "soup": "non-frozen",
    "cracker": "non-frozen",
    "chip": "non-frozen",
    "coffee": "non-frozen",
    "tea": "non-frozen",
    "bean": "non-frozen",
    "can": "non-frozen",
    "paper towel": "non-frozen",
    "toilet paper": "non-frozen",
}

GROCERY_DEFAULT_CATEGORIES = [
    "Pharmacy",
    "Fruits & Vegetables",
    "Frozen food",
    "Refrigerated food",
    "Non-frozen food",
    "Other",
]


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
            CREATE TABLE IF NOT EXISTS groups (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
                group_id      INTEGER REFERENCES groups(id)
            );

            CREATE TABLE IF NOT EXISTS stores (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id   INTEGER NOT NULL REFERENCES groups(id),
                name       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(group_id, name)
            );

            CREATE TABLE IF NOT EXISTS categories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id   INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                UNIQUE(store_id, name)
            );

            CREATE TABLE IF NOT EXISTS items (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                quantity    TEXT NOT NULL DEFAULT '',
                note        TEXT NOT NULL DEFAULT '',
                checked     INTEGER NOT NULL DEFAULT 0,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                created_by  TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                checked_at  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_items_store ON items(store_id);
            CREATE INDEX IF NOT EXISTS idx_categories_store ON categories(store_id);
            """
        )
        _migrate_items_sort_order(conn)
        _migrate_items_category_id(conn)
        _migrate_groups(conn)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_stores_group ON stores(group_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id)"
        )


def _migrate_groups(conn: sqlite3.Connection) -> None:
    """Add groups and scope users/stores to a group. Existing data → 'Household'."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS groups (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )
        """
    )
    row = conn.execute("SELECT id FROM groups WHERE name = 'Household'").fetchone()
    if row:
        default_gid = int(row["id"])
    else:
        cur = conn.execute("INSERT INTO groups (name) VALUES ('Household')")
        default_gid = int(cur.lastrowid)

    user_cols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
    if "group_id" not in user_cols:
        conn.execute(
            "ALTER TABLE users ADD COLUMN group_id INTEGER REFERENCES groups(id)"
        )
    conn.execute(
        "UPDATE users SET group_id = ? WHERE group_id IS NULL", (default_gid,)
    )

    store_cols = {r[1] for r in conn.execute("PRAGMA table_info(stores)")}
    if "group_id" not in store_cols:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.executescript(
            f"""
            CREATE TABLE stores_new (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id   INTEGER NOT NULL REFERENCES groups(id),
                name       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(group_id, name)
            );
            INSERT INTO stores_new (id, group_id, name, created_at)
                SELECT id, {default_gid}, name, created_at FROM stores;
            DROP TABLE stores;
            ALTER TABLE stores_new RENAME TO stores;
            CREATE INDEX IF NOT EXISTS idx_stores_group ON stores(group_id);
            """
        )
        conn.execute("PRAGMA foreign_keys=ON")
    else:
        # Legacy rows without a group (shouldn't happen after first migrate)
        conn.execute(
            "UPDATE stores SET group_id = ? WHERE group_id IS NULL", (default_gid,)
        )


def _migrate_items_sort_order(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(items)")}
    if "sort_order" not in cols:
        conn.execute(
            "ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
        )
        conn.execute("UPDATE items SET sort_order = id")


def _migrate_items_category_id(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(items)")}
    if "category_id" not in cols:
        conn.execute(
            "ALTER TABLE items ADD COLUMN category_id INTEGER "
            "REFERENCES categories(id) ON DELETE SET NULL"
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------

def list_groups() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            """
            SELECT g.id, g.name,
                   (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS user_count,
                   (SELECT COUNT(*) FROM stores s WHERE s.group_id = g.id) AS store_count
            FROM groups g
            ORDER BY g.name COLLATE NOCASE
            """
        )
        return [dict(row) for row in cur]


def get_group(group_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name FROM groups WHERE id = ?", (group_id,)
        ).fetchone()
        return dict(row) if row else None


def create_group(name: str) -> int:
    with get_db() as conn:
        cur = conn.execute("INSERT INTO groups (name) VALUES (?)", (name,))
        return int(cur.lastrowid)


def rename_group(group_id: int, name: str) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE groups SET name = ? WHERE id = ?", (name, group_id)
        )
        return cur.rowcount


def delete_group(group_id: int) -> None:
    with get_db() as conn:
        users_n = conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE group_id = ?", (group_id,)
        ).fetchone()["n"]
        stores_n = conn.execute(
            "SELECT COUNT(*) AS n FROM stores WHERE group_id = ?", (group_id,)
        ).fetchone()["n"]
        if users_n or stores_n:
            raise ValueError(
                "Cannot delete a group that still has users or stores"
            )
        conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))


def default_group_id() -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM groups ORDER BY id ASC LIMIT 1"
        ).fetchone()
        if row:
            return int(row["id"])
        cur = conn.execute("INSERT INTO groups (name) VALUES ('Household')")
        return int(cur.lastrowid)


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
            """
            SELECT u.id, u.username, u.password_hash, u.role, u.group_id,
                   g.name AS group_name
            FROM users u
            LEFT JOIN groups g ON g.id = u.group_id
            WHERE u.username = ?
            """,
            (username,),
        ).fetchone()
        return dict(row) if row else None


def insert_user(
    username: str,
    password_hash: str,
    role: str,
    group_id: Optional[int] = None,
) -> int:
    gid = group_id if group_id is not None else default_group_id()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, role, group_id) VALUES (?, ?, ?, ?)",
            (username, password_hash, role, gid),
        )
        return int(cur.lastrowid)


def list_users() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            """
            SELECT u.id, u.username, u.role, u.group_id, g.name AS group_name
            FROM users u
            LEFT JOIN groups g ON g.id = u.group_id
            ORDER BY g.name COLLATE NOCASE, u.username COLLATE NOCASE
            """
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


def set_user_group(username: str, group_id: int) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE users SET group_id = ? WHERE username = ?",
            (group_id, username),
        )
        return cur.rowcount


# ---------------------------------------------------------------------------
# Stores
# ---------------------------------------------------------------------------

def list_stores(group_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            """
            SELECT s.id, s.name, s.group_id,
                   COALESCE(SUM(CASE WHEN i.checked = 0 THEN 1 ELSE 0 END), 0) AS open_count,
                   COUNT(i.id) AS item_count
            FROM stores s
            LEFT JOIN items i ON i.store_id = s.id
            WHERE s.group_id = ?
            GROUP BY s.id
            ORDER BY s.name COLLATE NOCASE
            """,
            (group_id,),
        )
        return [dict(row) for row in cur]


def get_store(store_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, group_id FROM stores WHERE id = ?", (store_id,)
        ).fetchone()
        return dict(row) if row else None


def create_store(name: str, group_id: int) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO stores (group_id, name, created_at) VALUES (?, ?, ?)",
            (group_id, name, _now()),
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
# Categories
# ---------------------------------------------------------------------------

def list_categories(store_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            """
            SELECT id, store_id, name, sort_order
            FROM categories
            WHERE store_id = ?
            ORDER BY sort_order ASC, id ASC
            """,
            (store_id,),
        )
        return [dict(row) for row in cur]


def get_category(category_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, store_id, name, sort_order FROM categories WHERE id = ?",
            (category_id,),
        ).fetchone()
        return dict(row) if row else None


def create_category(store_id: int, name: str) -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories WHERE store_id = ?",
            (store_id,),
        ).fetchone()
        cur = conn.execute(
            "INSERT INTO categories (store_id, name, sort_order) VALUES (?, ?, ?)",
            (store_id, name, int(row["next"])),
        )
        return int(cur.lastrowid)


def rename_category(category_id: int, name: str) -> int:
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE categories SET name = ? WHERE id = ?", (name, category_id)
        )
        return cur.rowcount


def delete_category(category_id: int) -> int:
    with get_db() as conn:
        conn.execute(
            "UPDATE items SET category_id = NULL WHERE category_id = ?",
            (category_id,),
        )
        cur = conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        return cur.rowcount


def reorder_categories(store_id: int, category_ids: List[int]) -> None:
    with get_db() as conn:
        for pos, cat_id in enumerate(category_ids, start=1):
            conn.execute(
                "UPDATE categories SET sort_order = ? WHERE id = ? AND store_id = ?",
                (pos, cat_id, store_id),
            )


def seed_grocery_categories(store_id: int) -> List[Dict[str, Any]]:
    """Insert grocery defaults if the store has no categories yet."""
    existing = list_categories(store_id)
    if existing:
        return existing
    with get_db() as conn:
        for pos, name in enumerate(GROCERY_DEFAULT_CATEGORIES, start=1):
            conn.execute(
                "INSERT INTO categories (store_id, name, sort_order) VALUES (?, ?, ?)",
                (store_id, name, pos),
            )
    return list_categories(store_id)


def suggest_category(store_id: int, item_name: str) -> Optional[int]:
    """Return a category_id suggestion, or None."""
    name = (item_name or "").strip()
    if not name:
        return None
    categories = list_categories(store_id)
    if not categories:
        return None

    # 1) Prior assignment for the same item name at this store
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT category_id FROM items
            WHERE store_id = ?
              AND category_id IS NOT NULL
              AND LOWER(name) = LOWER(?)
            ORDER BY id DESC
            LIMIT 1
            """,
            (store_id, name),
        ).fetchone()
        if row and row["category_id"]:
            return int(row["category_id"])

    # 2) Keyword map vs category names
    lower_name = name.lower()
    family: Optional[str] = None
    # Prefer longer keyword matches first
    for keyword in sorted(GROCERY_KEYWORD_HINTS.keys(), key=len, reverse=True):
        if keyword in lower_name:
            family = GROCERY_KEYWORD_HINTS[keyword]
            break
    if not family:
        return None

    for cat in categories:
        cat_lower = cat["name"].lower()
        if family in cat_lower:
            return int(cat["id"])
        # Broader aliases for grocery default names
        if family == "fruit" and ("fruit" in cat_lower or "produce" in cat_lower or "vegetable" in cat_lower):
            return int(cat["id"])
        if family == "vegetable" and ("vegetable" in cat_lower or "produce" in cat_lower or "fruit" in cat_lower):
            return int(cat["id"])
        if family == "pharmacy" and ("pharm" in cat_lower or "health" in cat_lower or "personal" in cat_lower):
            return int(cat["id"])
        if family == "frozen" and "frozen" in cat_lower:
            return int(cat["id"])
        if family == "refrigerat" and ("refrigerat" in cat_lower or "dairy" in cat_lower or "meat" in cat_lower):
            return int(cat["id"])
        if family == "non-frozen" and (
            "non-frozen" in cat_lower
            or "pantry" in cat_lower
            or "grocery" in cat_lower
            or "other" in cat_lower
        ):
            return int(cat["id"])

    return None


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

def list_items(store_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.execute(
            """
            SELECT id, store_id, name, quantity, note, checked, category_id,
                   created_by, created_at, checked_at
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
    store_id: int,
    name: str,
    quantity: str,
    note: str,
    created_by: str,
    category_id: Optional[int] = None,
) -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM items WHERE store_id = ?",
            (store_id,),
        ).fetchone()
        cur = conn.execute(
            """
            INSERT INTO items (
                store_id, name, quantity, note, sort_order, category_id, created_by, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                store_id,
                name,
                quantity,
                note,
                int(row["next"]),
                category_id,
                created_by,
                _now(),
            ),
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
    category_id: Any = ...,
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
    # Use ... sentinel so callers can explicitly clear category_id to NULL
    if category_id is not ...:
        sets.append("category_id = ?")
        params.append(category_id)
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
