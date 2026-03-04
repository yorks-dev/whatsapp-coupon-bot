"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");

const { parseBoolean } = require("./runtime-options");

const hasManagedPort = Boolean(process.env.PORT);
const CONTROL_HOST =
  process.env.CONTROL_HOST || (hasManagedPort ? "0.0.0.0" : "127.0.0.1");
const CONTROL_PORT = Number(process.env.PORT || process.env.CONTROL_PORT || 8788);
const LOG_LIMIT = Number(process.env.CONTROL_LOG_LIMIT || 100);
const LOG_LINE_MAX_CHARS = Number(process.env.LOG_LINE_MAX_CHARS || 500);
const BOT_MAX_OLD_SPACE_MB = Number(process.env.BOT_MAX_OLD_SPACE_MB || 160);
const CONTROL_EVENT_PREFIX = "__CONTROL_EVENT__";
const HEALTH_RATE_LIMIT_MAX = Number(process.env.HEALTH_RATE_LIMIT_MAX || 30);
const HEALTH_RATE_LIMIT_WINDOW_MS =
  Number(process.env.HEALTH_RATE_LIMIT_WINDOW_SECONDS || 60) * 1000;
const AUTH_FAIL_RATE_LIMIT_MAX = Number(
  process.env.AUTH_FAIL_RATE_LIMIT_MAX || 20
);
const AUTH_FAIL_RATE_LIMIT_WINDOW_MS =
  Number(process.env.AUTH_FAIL_RATE_LIMIT_WINDOW_SECONDS || 300) * 1000;
const RATE_LIMIT_MAX_KEYS = Number(process.env.RATE_LIMIT_MAX_KEYS || 5000);
const REQUIRE_CONTROL_AUTH = parseBoolean(
  process.env.REQUIRE_CONTROL_AUTH,
  false
);
const CONTROL_AUTH_EMAIL = String(process.env.CONTROL_AUTH_EMAIL || "").trim();
const CONTROL_AUTH_PASSWORD = String(
  process.env.CONTROL_AUTH_PASSWORD || ""
).trim();
const ALWAYS_CONNECTED_MODE = parseBoolean(
  process.env.ALWAYS_CONNECTED_MODE,
  true
);
const MONITORING_ENABLED_ON_BOOT = parseBoolean(
  process.env.MONITORING_ENABLED_ON_BOOT,
  false
);

const state = {
  running: false,
  pid: null,
  startedAt: null,
  stoppedAt: null,
  exitCode: null,
  signal: null,
  config: null,
  botProcess: null,
  botConnected: false,
  monitoringEnabled: false,
  needQr: false,
  qr: null,
  lastEventType: null,
  lastEventAt: null,
  lastDisconnectReason: null,
  logs: []
};
const rateLimitState = {
  health: new Map(),
  authFail: new Map()
};

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseBasicAuthHeader(value) {
  const header = String(value || "");
  if (!header.startsWith("Basic ")) return null;

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return {
      email: decoded.slice(0, idx),
      password: decoded.slice(idx + 1)
    };
  } catch (_) {
    return null;
  }
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  if (realIp) return realIp;
  return req.socket?.remoteAddress || "unknown";
}

function pruneRateLimitMap(map, now, windowMs) {
  for (const [key, record] of map) {
    if (!record || now - record.lastSeenAt > windowMs * 2) {
      map.delete(key);
    }
  }
  while (map.size > RATE_LIMIT_MAX_KEYS) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

function consumeRateLimit(map, key, maxHits, windowMs) {
  const now = Date.now();
  let record = map.get(key);

  if (!record || now - record.windowStartAt >= windowMs) {
    record = {
      windowStartAt: now,
      hits: 1,
      lastSeenAt: now
    };
    map.set(key, record);
    pruneRateLimitMap(map, now, windowMs);
    return { allowed: true, remaining: Math.max(0, maxHits - 1), retryAfter: 0 };
  }

  record.hits += 1;
  record.lastSeenAt = now;
  map.delete(key);
  map.set(key, record);

  const remaining = Math.max(0, maxHits - record.hits);
  if (record.hits <= maxHits) {
    return { allowed: true, remaining, retryAfter: 0 };
  }

  const retryAfterMs = windowMs - (now - record.windowStartAt);
  return {
    allowed: false,
    remaining: 0,
    retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000))
  };
}

function isAuthorized(req) {
  if (!REQUIRE_CONTROL_AUTH) return true;
  const parsed = parseBasicAuthHeader(req.headers.authorization);
  if (!parsed) return false;
  return (
    safeEqual(parsed.email, CONTROL_AUTH_EMAIL) &&
    safeEqual(parsed.password, CONTROL_AUTH_PASSWORD)
  );
}

function sendAuthRequired(res) {
  res.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": 'Basic realm="Coupon Bot Control", charset="UTF-8"'
  });
  res.end(
    JSON.stringify({ ok: false, error: "auth_required", message: "Unauthorized" })
  );
}

function sendRateLimited(res, retryAfterSeconds) {
  res.writeHead(429, {
    "content-type": "application/json",
    "retry-after": String(retryAfterSeconds)
  });
  res.end(
    JSON.stringify({
      ok: false,
      error: "rate_limited",
      message: "Too many requests",
      retryAfterSeconds
    })
  );
}

function appendLog(source, text) {
  if (LOG_LIMIT <= 0) return;

  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const trimmedLine =
      line.length > LOG_LINE_MAX_CHARS
        ? line.slice(0, LOG_LINE_MAX_CHARS) + "…[truncated]"
        : line;
    state.logs.push({
      ts: new Date().toISOString(),
      source,
      line: trimmedLine
    });
  }

  while (state.logs.length > LOG_LIMIT) {
    state.logs.shift();
  }
}

function handleControlEvent(event) {
  if (!event || typeof event !== "object") return;

  const type = String(event.type || "").toLowerCase();
  state.lastEventType = type || null;
  state.lastEventAt = String(event.ts || new Date().toISOString());

  if (type === "qr") {
    if (state.botConnected && !state.needQr) {
      appendLog(
        "control",
        "Ignoring QR event because bot is already marked connected."
      );
      appendLog("control:event", JSON.stringify(event));
      return;
    }

    const qrValue = String(event.qr || "").trim();
    const isMalformedQr = !qrValue || qrValue.startsWith("undefined,");
    state.botConnected = false;
    state.needQr = true;
    if (isMalformedQr) {
      if (!state.qr) {
        state.qr = {
          value: "",
          updatedAt: String(event.ts || new Date().toISOString())
        };
      }
    } else {
      state.qr = {
        value: qrValue,
        updatedAt: String(event.ts || new Date().toISOString())
      };
    }
  } else if (type === "monitoring_state") {
    state.monitoringEnabled = parseBoolean(event.enabled, false);
    if (event.config && typeof event.config === "object") {
      state.config = {
        ...(state.config || {}),
        ...event.config
      };
    }
  } else if (type === "runtime_updated") {
    if (event.config && typeof event.config === "object") {
      state.config = {
        ...(state.config || {}),
        ...event.config
      };
    }
    if (Object.prototype.hasOwnProperty.call(event, "monitoringEnabled")) {
      state.monitoringEnabled = parseBoolean(event.monitoringEnabled, false);
    }
  } else if (type === "awaiting_qr" || type === "initializing") {
    state.botConnected = false;
    state.needQr = true;
    if (!state.qr) {
      state.qr = {
        value: "",
        updatedAt: String(event.ts || new Date().toISOString())
      };
    }
  } else if (type === "ready") {
    state.botConnected = true;
    state.needQr = false;
    state.qr = null;
  } else if (type === "authenticated") {
    state.botConnected = true;
    state.needQr = false;
    state.qr = null;
  } else if (type === "wa_state") {
    const waState = String(event.state || "").toUpperCase();
    if (waState === "CONNECTED") {
      state.botConnected = true;
      state.needQr = false;
      state.qr = null;
    }
  } else if (type === "disconnected") {
    state.botConnected = false;
    const reason = String(event.reason || "").toUpperCase();
    state.lastDisconnectReason = reason || null;
    if (reason.includes("LOGOUT")) {
      state.needQr = true;
    }
  } else if (type === "auth_failure" || type === "initialize_failed") {
    state.botConnected = false;
    state.needQr = true;
  }

  appendLog("control:event", JSON.stringify(event));
}

function processOutputChunk(source, chunk, streamBuffers, key) {
  streamBuffers[key] += String(chunk || "");
  const parts = streamBuffers[key].split(/\r?\n/);
  streamBuffers[key] = parts.pop() || "";

  for (const line of parts) {
    if (!line) continue;

    const markerIndex = line.indexOf(CONTROL_EVENT_PREFIX);
    if (markerIndex >= 0) {
      const payload = line.slice(markerIndex + CONTROL_EVENT_PREFIX.length);
      try {
        const event = JSON.parse(payload);
        handleControlEvent(event);
      } catch (_) {
        appendLog("control", `Invalid control event line: ${line}`);
      }
      continue;
    }

    appendLog(source, line);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listProcesses() {
  try {
    const raw = execSync("ps -ax -o pid=,command=", { encoding: "utf8" });
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          command: match[2]
        };
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

async function cleanupStaleProcesses() {
  const currentPid = process.pid;
  const trackedBotPid = state.botProcess?.pid ?? null;
  const candidates = listProcesses().filter((proc) => {
    if (!proc || !proc.pid || !proc.command) return false;
    if (proc.pid === currentPid) return false;
    if (trackedBotPid && proc.pid === trackedBotPid) return false;

    return (
      proc.command.includes("node src/index.js") ||
      proc.command.includes("session-coupon-bot")
    );
  });

  if (!candidates.length) return;

  appendLog(
    "control",
    `Cleaning stale lock-holder processes: ${candidates
      .map((p) => `${p.pid}`)
      .join(", ")}`
  );

  for (const proc of candidates) {
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch (_) { }
  }

  await sleep(1200);

  for (const proc of candidates) {
    if (!isPidAlive(proc.pid)) continue;
    try {
      process.kill(proc.pid, "SIGKILL");
      appendLog(
        "control",
        `Force-killed stale process pid=${proc.pid} (${proc.command})`
      );
    } catch (_) { }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function normalizeMess(rawMess) {
  const value = String(rawMess || "").trim().toLowerCase();
  if (!value || value === "all") return "neelkesh,firstman";
  if (value === "neelkesh" || value === "firstman") return value;
  return value
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

function normalizeMeal(rawMeal) {
  const value = String(rawMeal || "").trim().toLowerCase();
  if (value === "lunch" || value === "dinner" || value === "all") {
    return value;
  }
  // Backward compatibility for older clients.
  if (value === "auto" || value === "auto-time") return "all";
  return "all";
}

function normalizeRuntimeConfig(input = {}, fallback = {}) {
  return {
    meal: normalizeMeal(input.meal),
    mess: normalizeMess(input.mess),
    allowFromMe: parseBoolean(input.allowFromMe, fallback.allowFromMe ?? true),
    debugLogs: parseBoolean(input.debugLogs, fallback.debugLogs ?? true)
  };
}

function sendBotCommand(command) {
  if (!state.botProcess) return false;
  if (!state.botProcess.stdin || state.botProcess.stdin.destroyed) return false;

  try {
    state.botProcess.stdin.write(`${JSON.stringify(command)}\n`);
    return true;
  } catch (error) {
    appendLog("control", `Failed to send bot command: ${error?.message || error}`);
    return false;
  }
}

state.config = normalizeRuntimeConfig(
  {
    meal: process.env.ACTIVE_MEAL_MODE,
    mess: process.env.ALLOWED_MESS_NAMES,
    allowFromMe: process.env.ALLOW_FROM_ME,
    debugLogs: process.env.DEBUG_LOGS
  },
  {
    allowFromMe: false,
    debugLogs: false
  }
);
state.monitoringEnabled = MONITORING_ENABLED_ON_BOOT;

function getStatusPayload() {
  return {
    alwaysConnectedMode: ALWAYS_CONNECTED_MODE,
    running: state.running,
    monitoringEnabled: state.monitoringEnabled,
    botConnected: state.botConnected,
    needQr: state.needQr,
    qr: state.qr,
    pid: state.pid,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    exitCode: state.exitCode,
    signal: state.signal,
    config: state.config,
    logsEnabled: LOG_LIMIT > 0,
    logLimit: LOG_LIMIT,
    lastEventType: state.lastEventType,
    lastEventAt: state.lastEventAt,
    lastDisconnectReason: state.lastDisconnectReason
  };
}

async function terminateBotProcess() {
  if (!state.botProcess) return { stopped: true, reason: "not_running" };

  const proc = state.botProcess;
  appendLog("control", `Stopping bot process pid=${proc.pid}`);

  await new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    const timeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch (_) { }
      finish();
    }, 8000);

    proc.once("exit", () => {
      clearTimeout(timeout);
      finish();
    });

    try {
      proc.kill("SIGINT");
    } catch (_) {
      clearTimeout(timeout);
      finish();
    }
  });

  state.botConnected = false;
  state.monitoringEnabled = false;
  state.needQr = false;
  state.qr = null;

  return { stopped: true, reason: "stopped" };
}

async function ensureBotStarted(configInput = {}) {
  const normalizedConfig = normalizeRuntimeConfig(configInput, state.config || {});
  state.config = {
    ...(state.config || {}),
    ...normalizedConfig
  };

  if (state.botProcess && isPidAlive(state.botProcess.pid)) {
    sendBotCommand({ type: "set_runtime", config: state.config });
    sendBotCommand({ type: "set_monitoring", enabled: state.monitoringEnabled });
    return getStatusPayload();
  }

  await cleanupStaleProcesses();

  const botPath = path.join(__dirname, "index.js");
  const args = [
    ...(BOT_MAX_OLD_SPACE_MB > 0
      ? [`--max-old-space-size=${Math.max(96, BOT_MAX_OLD_SPACE_MB)}`]
      : []),
    botPath,
    "--meal",
    state.config.meal,
    "--mess",
    state.config.mess,
    "--allow-from-me",
    String(state.config.allowFromMe),
    "--debug",
    String(state.config.debugLogs)
  ];

  const child = spawn(process.execPath, args, {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      CONTROL_EVENT_MODE: "true",
      // When control server is active, its /api/health is the external healthcheck.
      HEALTH_PORT: process.env.BOT_HEALTH_PORT || "0",
      MONITORING_ENABLED_ON_BOOT: String(state.monitoringEnabled)
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  state.botProcess = child;
  state.running = true;
  state.pid = child.pid;
  state.startedAt = new Date().toISOString();
  state.stoppedAt = null;
  state.exitCode = null;
  state.signal = null;
  state.botConnected = false;
  state.needQr = false;
  state.qr = null;

  appendLog(
    "control",
    `Started bot pid=${child.pid} meal=${state.config.meal} mess=${state.config.mess}`
  );

  const streamBuffers = {
    stdout: "",
    stderr: ""
  };

  child.stdout.on("data", (chunk) =>
    processOutputChunk("bot:stdout", chunk, streamBuffers, "stdout")
  );
  child.stderr.on("data", (chunk) =>
    processOutputChunk("bot:stderr", chunk, streamBuffers, "stderr")
  );
  child.on("exit", (code, signal) => {
    state.running = false;
    state.monitoringEnabled = false;
    state.botConnected = false;
    state.pid = null;
    state.stoppedAt = new Date().toISOString();
    state.exitCode = code;
    state.signal = signal;
    state.botProcess = null;
    appendLog(
      "control",
      `Bot exited code=${String(code)} signal=${String(signal)}`
    );
  });

  // Push runtime + monitoring state once stdin is open.
  setTimeout(() => {
    sendBotCommand({ type: "set_runtime", config: state.config });
    sendBotCommand({ type: "set_monitoring", enabled: state.monitoringEnabled });
  }, 100);

  return getStatusPayload();
}

async function startBot(configInput = {}) {
  const normalizedConfig = normalizeRuntimeConfig(configInput, state.config || {});
  state.config = {
    ...(state.config || {}),
    ...normalizedConfig
  };
  state.monitoringEnabled = true;

  await ensureBotStarted(state.config);
  sendBotCommand({ type: "set_runtime", config: state.config });
  sendBotCommand({ type: "set_monitoring", enabled: true });

  appendLog(
    "control",
    `Monitoring enabled meal=${state.config.meal} mess=${state.config.mess}`
  );
  return getStatusPayload();
}

async function stopBot() {
  if (!state.botProcess) return { stopped: true, reason: "not_running" };

  state.monitoringEnabled = false;
  sendBotCommand({ type: "set_monitoring", enabled: false });
  appendLog("control", "Monitoring disabled (bot kept connected).");
  return { stopped: true, reason: "monitoring_disabled" };
}

async function requestQr(options = {}) {
  await ensureBotStarted(state.config || {});

  const force = parseBoolean(options.force, false);
  if (state.botConnected && !force) {
    return getStatusPayload();
  }

  if (!sendBotCommand({ type: "request_qr", force })) {
    throw new Error("Bot process unavailable for QR request");
  }

  state.needQr = true;
  if (force) state.qr = null;
  appendLog("control", `QR requested (force=${String(force)})`);
  return getStatusPayload();
}

function getUiHtml() {
  const uiPath = path.join(__dirname, "control-ui.html");
  return fs.readFileSync(uiPath, "utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;
    const isHealthEndpoint = req.method === "GET" && pathname === "/api/health";
    const clientIp = getClientIp(req);

    if (isHealthEndpoint) {
      const healthLimit = consumeRateLimit(
        rateLimitState.health,
        `health:${clientIp}`,
        Math.max(1, HEALTH_RATE_LIMIT_MAX),
        Math.max(1000, HEALTH_RATE_LIMIT_WINDOW_MS)
      );
      if (!healthLimit.allowed) {
        sendRateLimited(res, healthLimit.retryAfter);
        return;
      }
    }

    if (!isHealthEndpoint && !isAuthorized(req)) {
      const authLimit = consumeRateLimit(
        rateLimitState.authFail,
        `auth:${clientIp}`,
        Math.max(1, AUTH_FAIL_RATE_LIMIT_MAX),
        Math.max(1000, AUTH_FAIL_RATE_LIMIT_WINDOW_MS)
      );
      if (!authLimit.allowed) {
        sendRateLimited(res, authLimit.retryAfter);
        return;
      }
      sendAuthRequired(res);
      return;
    }

    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(getUiHtml());
      return;
    }

    if (req.method === "GET" && pathname === "/api/status") {
      sendJson(res, 200, getStatusPayload());
      return;
    }

    if (req.method === "GET" && pathname === "/api/logs") {
      if (LOG_LIMIT <= 0) {
        sendJson(res, 200, { logs: [] });
        return;
      }
      const limit = Number(reqUrl.searchParams.get("limit") || 300);
      const safeLimit = Number.isFinite(limit)
        ? Math.max(1, Math.min(1000, limit))
        : 300;
      sendJson(res, 200, {
        logs: state.logs.slice(-safeLimit)
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/start") {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const status = await startBot(body || {});
      sendJson(res, 200, { ok: true, status });
      return;
    }

    if (req.method === "POST" && pathname === "/api/stop") {
      const result = await stopBot();
      sendJson(res, 200, { ok: true, result, status: getStatusPayload() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/request-qr") {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const status = await requestQr(body || {});
      sendJson(res, 200, { ok: true, status });
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true, control: "up" });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error?.message || String(error) });
  }
});

async function shutdown() {
  try {
    await terminateBotProcess();
  } catch (_) { }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(CONTROL_PORT, CONTROL_HOST, () => {
  if (REQUIRE_CONTROL_AUTH && (!CONTROL_AUTH_EMAIL || !CONTROL_AUTH_PASSWORD)) {
    console.error(
      "Control auth is enabled but CONTROL_AUTH_EMAIL or CONTROL_AUTH_PASSWORD is missing."
    );
  }
  console.log(
    `Control server running at http://${CONTROL_HOST}:${CONTROL_PORT} (GUI), auth=${REQUIRE_CONTROL_AUTH ? "on" : "off"}`
  );

  if (ALWAYS_CONNECTED_MODE) {
    appendLog(
      "control",
      `Always-connected mode enabled (monitoring=${state.monitoringEnabled})`
    );
    ensureBotStarted(state.config).catch((error) => {
      appendLog(
        "control",
        `Failed to start persistent bot runtime: ${error?.message || error}`
      );
    });
  }
});
