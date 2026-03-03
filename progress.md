# WhatsApp Coupon Bot Progress

Last updated: 2026-03-04 (Asia/Kolkata)

## Goal
Build a production-capable WhatsApp bot that:
- Monitors selected groups only.
- Uses typo-tolerant parsing (no single brittle regex).
- Supports mess names (`neelkesh`, `firstman`) and meal modes (`lunch`, `dinner`).
- Can be started with runtime flags (no manual `.env` edits each time).
- Can run long-term on local/VM with health checks, restart, and deployment path.

## Current Status
- [x] WhatsApp connection + QR auth + persistent session.
- [x] Group filtering by ID/name.
- [x] Private reply flow.
- [x] Debug logs and group traffic logs.
- [x] Auto reconnect logic.
- [x] Health endpoint + optional keepalive ping support.
- [x] Matching logic switched to token-based fuzzy parser.
- [x] Global executable command (`coupon-bot ...`) implemented.
- [x] UI control panel implemented for start/stop + mess/meal selection.
- [x] GUI QR re-login flow when session expires/logout happens.
- [x] Simplified runtime mode: only mess + meal (`lunch`/`dinner`/`all`), no strict toggle.
- [x] Coupon-word requirement removed (seller + mess + meal are sufficient).
- [x] Cloud deployment pack added (PM2 + Docker + deployment guide).
- [x] Render deployment blueprint added (`render.yaml`) with persistent auth disk path.

## Implementation Plan

### Phase 1: Fuzzy Parser Core (Priority: High)
- [x] Add `src/parser.js` with token-based normalization + fuzzy matching.
- [x] Inputs:
  - text body
  - allowed mess names (`neelkesh`, `firstman`)
  - active meal mode (`lunch`, `dinner`, `auto`)
- [x] Output:
  - `matched` boolean
  - `MESS_NAME`
  - `MESS_TIME`
  - `confidence`
  - `reasons` (why matched/skipped)
- [x] Handle typos:
  - selling variants: `selling`, `seeling`, `seling`, etc.
  - coupon variants: `coupon`, `cupon`, `caupan`, `coupan`, `copon`
  - mess names near-match for `neelkesh` and `firstman`
- [x] If meal missing but intent+name+coupon present:
  - use active runtime meal mode.

### Phase 2: Integrate Parser Into Bot Loop (Priority: High)
- [x] Replace regex gate in `src/index.js` with parser result.
- [x] Keep existing sender resolution + fallback send logic.
- [x] Keep message dedupe + bounded memory behavior.
- [x] Log structured parser results in debug mode.

### Phase 3: Runtime Controls Via CLI Flags (Priority: High)
- [x] Add CLI args support:
  - `--meal lunch|dinner|auto-time`
  - `--mess neelkesh|firstman|all`
  - optional `--headless true|false`
- [x] Precedence:
  - CLI args > `.env` defaults.
- [x] Update README usage examples.

### Phase 4: Global Executable (Priority: Medium)
- [x] Add `bin/coupon-bot.js`.
- [x] Add `package.json` `bin` mapping.
- [x] Commands:
  - `coupon-bot start --meal lunch --mess neelkesh`
  - `coupon-bot start --meal dinner --mess firstman`
- [x] Test with `npm link`.

### Phase 5: UI Control Panel (shadcn/ui) (Priority: Medium)
- [x] Add local GUI control server + UI (`src/control-server.js`, `src/control-ui.html`).
- [x] Add UI controls for:
  - meal select
  - mess select
  - start/stop actions
  - live logs panel
  - status/health card
- [x] API endpoints:
  - `POST /api/start`
  - `POST /api/stop`
  - `GET /api/status`
  - `GET /api/logs`

### Phase 6: Always-On Runtime + Deployment (Priority: Medium)
- [x] Add PM2 ecosystem config.
- [x] Add Dockerfile.
- [x] Add deploy guide for:
  - local machine service mode
  - VM (Oracle/GCP/AWS EC2)
- [x] Persist `.wwebjs_auth` in mounted path.

### Phase 7: Hardening + Tests (Priority: Medium)
- [x] Unit tests for parser (typos, missing meal, false positives).
- [x] Integration-style test for runtime+parser flow.
- [x] Add failure-mode docs (LID errors, reconnect, session lock).

## Environment Strategy
- `.env` stays as defaults only.
- Daily operation should use CLI flags:
  - lunch use-case
  - dinner use-case
- No repeated manual regex edits in `.env`.

## Acceptance Criteria
- [x] `selling neelkesh lunch coupon` matches.
- [x] `Seeling neelksh lunch coupan` still matches (fuzzy).
- [x] `selling firstman coupon` matches and uses active meal mode if meal missing.
- [x] `i want neelkesh lunch coupon` does not trigger.
- [x] Bot can be started by single command with meal + mess.
- [x] Bot can run continuously with health endpoint + auto reconnect.

## Next Action
Ongoing: use GUI/CLI operationally and tune aliases per live message patterns.
