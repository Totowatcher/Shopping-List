# Shopping-List — Hosting on the steve MacBook server

> **Production:** shared **Docker Compose** stack with RSGL-Points and Travel-Research.
> Redeploy from Windows: `.\redeploy-sl.ps1`
> Stack docs: `../RSGL-Points/deploy/docker/README.md`
> Public URL: `https://steve.tail09ce3d.ts.net/shop/`

Shopping-List runs on the **same host** as RSGL-Points and Travel-Research. All three apps share the compose stack's **Caddy** on port **80** and **Tailscale Funnel** on **443**. Each app has its own backend port and static files directory.

| App | Compose service | API | Static root (in Caddy) | Public URL |
|-----|-----------------|-----|------------------------|------------|
| RSGL-Points | `rsgl-api` | `:8000` | `/srv/rsgl/dist` | `https://steve.tail09ce3d.ts.net/rsgl/` |
| Travel-Research | `travel-api` | `:8002` | `/srv/travel/dist` | `https://steve.tail09ce3d.ts.net/travel/` |
| Shopping-List | `shop-api` | `:8004` | `/srv/shop/dist` | `https://steve.tail09ce3d.ts.net/shop/` |

**Server:** `steve@100.117.145.116` (Tailscale)
**Repo on server:** `/home/steve/Shopping-List` (sibling of `RSGL-Points` and `Travel-Research`)

---

## One-time server setup

1. Clone the repo next to the others:

   ```bash
   cd ~
   git clone <your-github-url>/Shopping-List.git
   ```

2. Create the env file for compose:

   ```bash
   cd ~/RSGL-Points/deploy/docker
   cp .env.shop.example .env.shop
   # Set SL_JWT_SECRET, e.g.:
   #   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```

3. Build the frontend (subpath-aware; Docker bind-mounts `dist/`):

   ```bash
   cd ~/Shopping-List/web/frontend && npm ci && npm run build
   ```

4. Start / update the stack (the `shop-api` service and `/shop/` Caddy routes
   are already in `RSGL-Points/deploy/docker`):

   ```bash
   cd ~/RSGL-Points/deploy/docker
   docker compose up -d --build
   ```

5. Create the first admin user:

   ```bash
   docker compose exec shop-api python -m app.user_cli create-user admin 'PASSWORD' admin
   ```

6. Verify:

   ```bash
   curl -sS http://127.0.0.1/shop/api/health
   curl -sS https://steve.tail09ce3d.ts.net/shop/api/health
   ```

No Tailscale changes are needed — the funnel already forwards everything to Caddy on port 80, and Caddy routes `/shop/*` to the new service.

---

## Redeploy

From Windows (repo root):

```powershell
.\redeploy-sl.ps1              # pull + build frontend + rebuild shop-api + health check
.\redeploy-sl.ps1 -SkipNpmCi   # skip npm ci
.\redeploy-sl.ps1 -SkipBuild   # pull + compose only
```

On the server manually:

```bash
cd ~/Shopping-List && git pull
cd ~/Shopping-List/web/frontend && npm ci && npm run build
cd ~/RSGL-Points/deploy/docker && docker compose up -d --build shop-api
```

**Commit and push** Windows changes before redeploying — the server only gets what is on GitHub.

---

## Data

The SQLite database lives in the named Docker volume `shop_db`
(mounted at `/app/data/db/shopping_list.db` inside the container), so it
survives rebuilds. User management can also be done from the CLI:

```bash
docker compose exec shop-api python -m app.user_cli list-users
docker compose exec shop-api python -m app.user_cli create-user NAME PASSWORD user
docker compose exec shop-api python -m app.user_cli delete-user NAME
```

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| 502 / blank page | `docker compose ps`; `curl http://127.0.0.1/shop/api/health` |
| API OK, UI old | Rebuild the frontend on the server; `dist/` is not updated by `git pull` |
| Login always expires | `SL_JWT_SECRET` changed between deploys (tokens are signed with it) |

Logs: `docker compose logs -f shop-api`
