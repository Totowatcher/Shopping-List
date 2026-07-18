# Shopping-List

A shared shopping list web app. Keeps a separate list per store, supports multiple users with persistent logins, and works well on a laptop or an iPhone. Deployed alongside RSGL-Points and Travel-Research on the steve MacBook server.

## Features

- Separate list per store (Costco, Kroger, …) with open-item counts
- Add items with optional quantity and note; tap to check off ("in the cart")
- Clear all checked items in one tap
- Two roles: **admin** and **user** — same capabilities, except admins can
  create/delete users and reset passwords
- Logins persist for a year (JWT stored in localStorage)
- Responsive UI, sized for both desktop and iPhone

## Quick Start (Local Development)

### Backend

```powershell
cd web/backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Copy and edit .env — set SL_JWT_SECRET
copy .env.example .env

# Create first admin user
python -m app.user_cli create-user admin yourpassword admin

# Run the backend
uvicorn app.main:app --host 127.0.0.1 --port 8004 --reload
```

### Frontend

```powershell
cd web/frontend
npm install
npm run dev
```

Open http://localhost:5175/shop/ in your browser.

Or use the helper scripts from the repo root:

```powershell
.\start-sl-local.ps1   # backend :8004, frontend :5175
.\stop-sl-local.ps1
```

## Architecture

- **Backend**: Python FastAPI + SQLite
- **Frontend**: React 18 + Vite 5 (served under `/shop/`)
- **Auth**: JWT (HS256) + bcrypt, two roles (admin, user), long-lived tokens
- **Hosting**: Tailscale Funnel + shared Docker Compose stack with RSGL-Points and Travel-Research

## Deployment

Production redeploy from Windows (Docker):

```powershell
.\redeploy-sl.ps1
```

See `deploy/HOSTING.md` and `../RSGL-Points/deploy/docker/README.md` for the shared compose stack.
