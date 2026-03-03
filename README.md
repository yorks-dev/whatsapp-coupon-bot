# WhatsApp Coupon Bot

Production-focused WhatsApp group bot with:
- QR login + persistent session
- group filtering
- token-based fuzzy intent parser (seller + mess + meal)
- private 1:1 auto-reply
- GUI control panel (start/stop, mess select, meal select)
- global terminal command `coupon-bot`

## Quick Start

```bash
cd /Users/ayushdutta/dev/whatsapp-coupon-bot
npm install
cp .env.example .env
```

Run bot directly:

```bash
npm start
```

Run GUI controller:

```bash
npm run gui
```

Open GUI:

```text
http://127.0.0.1:8788
```

## Global Command

Link once:

```bash
cd /Users/ayushdutta/dev/whatsapp-coupon-bot
npm link
```

Use:

```bash
coupon-bot start --meal lunch --mess neelkesh
coupon-bot start --meal dinner --mess firstman
coupon-bot gui
```

## CLI Flags (Phase 3)

`src/index.js` supports:
- `--meal lunch|dinner|all`
- `--mess neelkesh|firstman|all|comma,list`
- `--allow-from-me true|false`
- `--debug true|false`
- `--headless true|false`

Precedence:
- CLI flags override `.env`.

## Parser Runtime Config

In `.env`:

- `ALLOWED_MESS_NAMES=neelkesh,firstman`
- `ACTIVE_MEAL_MODE=all`
- `MESS_ALIASES_JSON={"neelkesh":["neelksh"],"firstman":["fristman"]}`

Parser rules:
- Seller intent near sentence start
- Fuzzy mess-name match
- Meal (`lunch`/`dinner`) from text, or fallback when active mode is fixed to lunch/dinner

Examples:
- `seeling neelksh lunch caupan` -> match
- `selling firstman` + `ACTIVE_MEAL_MODE=dinner` -> match (`MESS_TIME=dinner`)
- `i want neelkesh lunch coupon` -> skip

## GUI Control Panel (Phase 5)

`src/control-server.js` provides:
- `GET /` GUI
- `POST /api/start` start monitoring with selected mess/meal
- `POST /api/stop` stop monitoring
- `GET /api/status` process status
- `GET /api/logs` recent logs
- `GET /api/health` health

If WhatsApp session expires/logs out, GUI automatically shows a scannable QR so you can re-login directly from the browser.
You can protect GUI/API with basic auth using:
- `REQUIRE_CONTROL_AUTH=true`
- `CONTROL_AUTH_EMAIL=<your email>`
- `CONTROL_AUTH_PASSWORD=<strong password>`

Note:
- `/api/health` remains open by design for external uptime monitors.

UI file:
- `src/control-ui.html`

## Environment Keys

Core:
- `TARGET_GROUP_IDS`
- `TARGET_GROUP_NAMES`
- `REPLY_MESSAGE`

Runtime:
- `ALLOW_FROM_ME`
- `DEBUG_LOGS`
- `LOG_ALL_GROUP_MESSAGES`
- `REPLY_COOLDOWN_SECONDS`

Stability:
- `HEADLESS`
- `AUTH_PATH`
- `CLIENT_ID`
- `AUTO_RESTART_ON_DISCONNECT`
- `RESTART_DELAY_MS`
- `DEDUPE_CACHE_SIZE`
- `MAX_RECENT_SENDERS`

Ops:
- `HEALTH_PORT`
- `KEEPALIVE_URL`
- `KEEPALIVE_INTERVAL_SECONDS`
- `CONTROL_HOST`
- `CONTROL_PORT`

## Tests

```bash
npm run test:parser
npm run test:runtime
```

## Deployment

See:
- `/Users/ayushdutta/dev/whatsapp-coupon-bot/DEPLOYMENT.md`

Includes:
- PM2 (`ecosystem.config.cjs`)
- Docker (`Dockerfile`)
- Render blueprint (`render.yaml`)
- AWS/VM notes + failure modes
