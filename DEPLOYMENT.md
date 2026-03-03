# Deployment Guide

## 1. Local (Recommended Start)

Install:

```bash
cd /Users/ayushdutta/dev/whatsapp-coupon-bot
npm install
```

Run bot:

```bash
coupon-bot start --meal lunch --mess neelkesh
```

Run GUI controller:

```bash
coupon-bot gui
```

Open:

```text
http://127.0.0.1:8788
```

## 2. PM2 Service Mode

Install PM2 globally:

```bash
npm i -g pm2
```

Start services:

```bash
cd /Users/ayushdutta/dev/whatsapp-coupon-bot
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs
```

## 3. Docker

Build:

```bash
docker build -t coupon-bot:latest .
```

Run bot:

```bash
docker run -d --name coupon-bot \
  -p 8787:8787 \
  -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth \
  --env-file .env \
  coupon-bot:latest
```

Run GUI controller:

```bash
docker run -d --name coupon-control \
  -p 8788:8788 \
  -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth \
  --env-file .env \
  coupon-bot:latest node src/control-server.js
```

## 4. AWS/VM Notes

- Use an always-on instance (EC2/VPS), not free auto-sleep app hosts.
- Persist `.wwebjs_auth` on disk/volume.
- Put GUI behind reverse proxy + auth.
- Keep `HEADLESS=true`.
- Use health endpoints:
  - bot health: `http://<host>:8787/health`
  - control health: `http://<host>:8788/api/health`

## 5. Failure Modes

- `No LID for user`: handled by fallback recipient ID attempts.
- Session lock error (`browser already running`): kill stale process using same auth dir.
- Disconnects: auto-reconnect is enabled via `AUTO_RESTART_ON_DISCONNECT=true`.

## 6. Render Deployment (Docker + GUI)

Important:
- Use a paid always-on plan (`starter` or above). Free services/workspaces can sleep/stop and break bot continuity.
- Keep WhatsApp auth on persistent disk (`/var/data/.wwebjs_auth`) so QR login survives restarts.

### 6.1 Push Code to GitHub

Render deploys from Git repositories.

```bash
cd /Users/ayushdutta/dev/whatsapp-coupon-bot
git init
git add .
git commit -m "render deploy config"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 6.2 Deploy with Blueprint

1. In Render dashboard: `New +` -> `Blueprint`.
2. Select your GitHub repo.
3. Render auto-detects `/Users/ayushdutta/dev/whatsapp-coupon-bot/render.yaml`.
4. Create the service.

### 6.3 Set Runtime Secrets/Config

In Render service environment variables, set:
- `TARGET_GROUP_IDS` (comma-separated `@g.us` IDs)
- `REPLY_MESSAGE`
- `REQUIRE_CONTROL_AUTH=true`
- `CONTROL_AUTH_EMAIL=<your email>`
- `CONTROL_AUTH_PASSWORD=<strong password>`
- optional `TARGET_GROUP_NAMES`

Defaults are already defined in `render.yaml` for:
- GUI web process (`node src/control-server.js`)
- headless Chromium
- persistent auth path
- reconnect/debug behavior

### 6.4 First Login

1. Open your service URL.
2. Click `Start Monitoring` in GUI.
3. Scan QR shown in GUI.
4. Once connected, status will show `connected=true`.
