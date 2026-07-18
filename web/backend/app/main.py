"""Shopping-List FastAPI application."""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth import (
    create_access_token,
    hash_password,
    require_admin,
    require_user,
    verify_password,
)
from .config import CORS_LAN_VITE_REGEX, CORS_ORIGINS, SL_BOOTSTRAP_USERS
from . import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    _bootstrap_users()
    yield


app = FastAPI(title="Shopping-List API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_LAN_VITE_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _bootstrap_users() -> None:
    if not SL_BOOTSTRAP_USERS or db.count_users() > 0:
        return
    try:
        users = json.loads(SL_BOOTSTRAP_USERS)
        for u in users:
            db.insert_user(u["username"], hash_password(u["password"]), u.get("role", "user"))
            logger.info("Bootstrapped user %s (%s)", u["username"], u.get("role", "user"))
    except Exception:
        logger.exception("Failed to bootstrap users")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


class PasswordRequest(BaseModel):
    password: str


class StoreRequest(BaseModel):
    name: str


class CreateItemRequest(BaseModel):
    name: str
    quantity: str = ""
    note: str = ""


class UpdateItemRequest(BaseModel):
    name: Optional[str] = None
    quantity: Optional[str] = None
    note: Optional[str] = None
    checked: Optional[bool] = None


# ---------------------------------------------------------------------------
# Health & auth
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/auth/login")
async def login(body: LoginRequest):
    user = db.get_user_by_username(body.username.strip())
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(user["username"], user["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
    }


@app.get("/api/auth/me")
async def auth_me(user: Dict[str, Any] = Depends(require_user)):
    return user


# ---------------------------------------------------------------------------
# Stores
# ---------------------------------------------------------------------------

@app.get("/api/stores")
async def get_stores(user: Dict[str, Any] = Depends(require_user)):
    return {"stores": db.list_stores()}


@app.post("/api/stores", status_code=201)
async def add_store(body: StoreRequest, user: Dict[str, Any] = Depends(require_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Store name required")
    try:
        store_id = db.create_store(name)
    except Exception:
        raise HTTPException(status_code=409, detail=f'A store named "{name}" already exists')
    return {"id": store_id, "name": name}


@app.put("/api/stores/{store_id}")
async def update_store(
    store_id: int, body: StoreRequest, user: Dict[str, Any] = Depends(require_user)
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Store name required")
    try:
        if not db.rename_store(store_id, name):
            raise HTTPException(status_code=404, detail="Store not found")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=409, detail=f'A store named "{name}" already exists')
    return {"id": store_id, "name": name}


@app.delete("/api/stores/{store_id}")
async def remove_store(store_id: int, user: Dict[str, Any] = Depends(require_user)):
    if not db.delete_store(store_id):
        raise HTTPException(status_code=404, detail="Store not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

@app.get("/api/stores/{store_id}/items")
async def get_items(store_id: int, user: Dict[str, Any] = Depends(require_user)):
    store = db.get_store(store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    return {"store": store, "items": db.list_items(store_id)}


@app.post("/api/stores/{store_id}/items", status_code=201)
async def add_item(
    store_id: int, body: CreateItemRequest, user: Dict[str, Any] = Depends(require_user)
):
    if not db.get_store(store_id):
        raise HTTPException(status_code=404, detail="Store not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Item name required")
    item_id = db.create_item(
        store_id, name, body.quantity.strip(), body.note.strip(), user["username"]
    )
    return {"id": item_id}


@app.patch("/api/items/{item_id}")
async def patch_item(
    item_id: int, body: UpdateItemRequest, user: Dict[str, Any] = Depends(require_user)
):
    if not db.get_item(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    if body.name is not None and not body.name.strip():
        raise HTTPException(status_code=422, detail="Item name cannot be empty")
    db.update_item(
        item_id,
        name=body.name.strip() if body.name is not None else None,
        quantity=body.quantity.strip() if body.quantity is not None else None,
        note=body.note.strip() if body.note is not None else None,
        checked=body.checked,
    )
    return {"ok": True}


@app.delete("/api/items/{item_id}")
async def remove_item(item_id: int, user: Dict[str, Any] = Depends(require_user)):
    if not db.delete_item(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


@app.post("/api/stores/{store_id}/clear-checked")
async def clear_checked(store_id: int, user: Dict[str, Any] = Depends(require_user)):
    if not db.get_store(store_id):
        raise HTTPException(status_code=404, detail="Store not found")
    removed = db.clear_checked_items(store_id)
    return {"removed": removed}


# ---------------------------------------------------------------------------
# Admin: user management
# ---------------------------------------------------------------------------

@app.get("/api/admin/users")
async def admin_list_users(admin: Dict[str, Any] = Depends(require_admin)):
    return {"users": db.list_users()}


@app.post("/api/admin/users", status_code=201)
async def admin_create_user(
    body: CreateUserRequest, admin: Dict[str, Any] = Depends(require_admin)
):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username required")
    if len(body.password) < 4:
        raise HTTPException(status_code=422, detail="Password must be at least 4 characters")
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=422, detail="Role must be 'admin' or 'user'")
    if db.get_user_by_username(username):
        raise HTTPException(status_code=409, detail=f'User "{username}" already exists')
    db.insert_user(username, hash_password(body.password), body.role)
    return {"username": username, "role": body.role}


@app.delete("/api/admin/users/{username}")
async def admin_delete_user(
    username: str, admin: Dict[str, Any] = Depends(require_admin)
):
    if username == admin["username"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if not db.delete_user(username):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@app.put("/api/admin/users/{username}/password")
async def admin_reset_password(
    username: str, body: PasswordRequest, admin: Dict[str, Any] = Depends(require_admin)
):
    if len(body.password) < 4:
        raise HTTPException(status_code=422, detail="Password must be at least 4 characters")
    if not db.update_user_password(username, hash_password(body.password)):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}
