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
const LOG_LIMIT = Number(process.env.CONTROL_LOG_LIMIT || 1000);
const CONTROL_EVENT_PREFIX = "__CONTROL_EVENT__";
const REQUIRE_CONTROL_AUTH = parseBoolean(
  process.env.REQUIRE_CONTROL_AUTH,
  false
);
const CONTROL_AUTH_EMAIL = String(process.env.CONTROL_AUTH_EMAIL || "").trim();
const CONTROL_AUTH_PASSWORD = String(
  process.env.CONTROL_AUTH_PASSWORD || ""
).trim();

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
  needQr: false,
  qr: null,
  logs: []
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

function appendLog(source, text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  for (const line of lines) {
    state.logs.push({
      ts: new Date().toISOString(),
      source,
      line
    });
  }

  while (state.logs.length > LOG_LIMIT) {
    state.logs.shift();
  }
}

function handleControlEvent(event) {
  if (!event || typeof event !== "object") return;

  const type = String(event.type || "").toLowerCase();

  if (type === "qr") {
    state.botConnected = false;
    state.needQr = true;
    state.qr = {
      value: String(event.qr || ""),
      updatedAt: String(event.ts || new Date().toISOString())
    };
  } else if (type === "ready") {
    state.botConnected = true;
    state.needQr = false;
    state.qr = null;
  } else if (type === "disconnected") {
    state.botConnected = false;
    const reason = String(event.reason || "").toUpperCase();
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

    if (line.startsWith(CONTROL_EVENT_PREFIX)) {
      const payload = line.slice(CONTROL_EVENT_PREFIX.length);
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
    } catch (_) {}
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
    } catch (_) {}
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

function getStatusPayload() {
  return {
    running: state.running,
    botConnected: state.botConnected,
    needQr: state.needQr,
    qr: state.qr,
    pid: state.pid,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    exitCode: state.exitCode,
    signal: state.signal,
    config: state.config
  };
}

async function stopBot() {
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
      } catch (_) {}
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
  state.needQr = false;
  state.qr = null;

  return { stopped: true, reason: "stopped" };
}

async function startBot(configInput = {}) {
  const meal = normalizeMeal(configInput.meal);
  const mess = normalizeMess(configInput.mess);
  const allowFromMe = parseBoolean(configInput.allowFromMe, true);
  const debugLogs = parseBoolean(configInput.debugLogs, true);

  if (state.botProcess) {
    await stopBot();
  }

  await cleanupStaleProcesses();

  const botPath = path.join(__dirname, "index.js");
  const args = [
    botPath,
    "--meal",
    meal,
    "--mess",
    mess,
    "--allow-from-me",
    String(allowFromMe),
    "--debug",
    String(debugLogs)
  ];

  const child = spawn(process.execPath, args, {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      CONTROL_EVENT_MODE: "true",
      // When control server is active, its /api/health is the external healthcheck.
      HEALTH_PORT: process.env.BOT_HEALTH_PORT || "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
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
  state.config = {
    meal,
    mess,
    allowFromMe,
    debugLogs
  };

  appendLog(
    "control",
    `Started bot pid=${child.pid} meal=${meal} mess=${mess}`
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

    if (!isHealthEndpoint && !isAuthorized(req)) {
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
    await stopBot();
  } catch (_) {}
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
});
