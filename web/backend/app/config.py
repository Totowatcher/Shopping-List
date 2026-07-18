import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = os.environ.get(
    "SL_DATABASE_PATH", str(BASE_DIR / "shopping_list.db")
)

JWT_SECRET = os.environ.get("SL_JWT_SECRET", "").strip()
# Long-lived tokens so logins persist (default: 365 days).
JWT_EXPIRE_MINUTES = int(os.environ.get("SL_JWT_EXPIRE_MINUTES", str(365 * 24 * 60)))

SL_BOOTSTRAP_USERS = os.environ.get("SL_BOOTSTRAP_USERS", "").strip()

_cors = os.environ.get(
    "SL_CORS_ORIGINS",
    "http://localhost:5175,http://127.0.0.1:5175",
)
CORS_ORIGINS = [o.strip() for o in _cors.split(",") if o.strip()]

_lan = os.environ.get("SL_CORS_LAN_VITE", "1").strip().lower()
CORS_LAN_VITE_REGEX = (
    None
    if _lan in ("0", "false", "no", "off")
    else r"^https?://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}):5175$"
)
