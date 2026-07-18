from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, status

from .config import JWT_EXPIRE_MINUTES, JWT_SECRET


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        return False


def create_access_token(username: str, role: str) -> str:
    if not JWT_SECRET:
        raise RuntimeError("SL_JWT_SECRET is not set")
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload: Dict[str, Any] = {
        "sub": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> Dict[str, Any]:
    if not JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is not configured: set SL_JWT_SECRET in environment.",
        )
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired; log in again.",
        ) from None
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        ) from None


def _bearer_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization: Bearer <token>",
        )
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization: Bearer <token>",
        )
    return token


def get_current_user(
    authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    token = _bearer_token(authorization)
    payload = decode_access_token(token)
    username = payload.get("sub")
    role = payload.get("role")
    if not username or not isinstance(username, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    if role not in ("admin", "user"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid role in token",
        )
    return {"username": username, "role": role}


def require_user(_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return _user


def require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
