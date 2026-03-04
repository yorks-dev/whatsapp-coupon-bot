require("dotenv").config();

const http = require("http");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { parseCouponMessage } = require("./parser");
const {
  parseCsv,
  parseBoolean,
  parseJsonObject,
  resolveMealMode,
  resolveMessNames,
  resolveRuntimeOptions
} = require("./runtime-options");

function toLowerSet(items) {
  return new Set(items.map((item) => item.toLowerCase()));
}

function normalizeContactId(rawId) {
  if (!rawId || typeof rawId !== "string") return null;

  const [left, right = "c.us"] = rawId.split("@");
  const cleanLeft = left.split(":")[0].replace(/[^\d]/g, "");
  if (!cleanLeft) return null;

  return `${cleanLeft}@${right}`;
}

function buildSenderCandidates(rawId) {
  if (!rawId || typeof rawId !== "string") return [];

  const [left, right = "c.us"] = rawId.split("@");
  const baseLeft = left.split(":")[0];
  const digits = baseLeft.replace(/[^\d]/g, "");
  const candidates = [];

  if (baseLeft && right) {
    candidates.push(`${baseLeft}@${right}`);
  }
  if (digits) {
    if (right) candidates.push(`${digits}@${right}`);
    if (right !== "c.us") candidates.push(`${digits}@c.us`);
    if (right !== "lid") candidates.push(`${digits}@lid`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function isLikelyIdResolutionError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("no lid for user") ||
    msg.includes("invalid wid") ||
    msg.includes("chat not found")
  );
}

async function sendMessageToFirstResolvableId(client, candidateIds, text) {
  let lastError = null;

  for (const candidateId of candidateIds) {
    try {
      await client.sendMessage(candidateId, text);
      return candidateId;
    } catch (error) {
      lastError = error;
      if (!isLikelyIdResolutionError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Failed to resolve a valid recipient ID");
}

function extractPhoneNumber(contactId) {
  if (!contactId) return "";

  const left = contactId.split("@")[0] || "";
  return left.replace(/[^\d]/g, "");
}

function fillTemplate(template, values) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key]);
    }
    return "";
  });
}

const runtimeOptions = resolveRuntimeOptions({
  env: process.env,
  argv: process.argv.slice(2),
  now: new Date()
});
let allowedMessNames = runtimeOptions.allowedMessNames;
const messAliases = parseJsonObject(process.env.MESS_ALIASES_JSON, {});
const activeMealModeInput = runtimeOptions.activeMealModeInput;
let activeMealMode = runtimeOptions.activeMealMode;
const targetGroupIds = parseCsv(process.env.TARGET_GROUP_IDS);
const targetGroupNames = parseCsv(process.env.TARGET_GROUP_NAMES);
const targetGroupNameSet = toLowerSet(targetGroupNames);
const replyTemplate =
  process.env.REPLY_MESSAGE ||
  "I want to buy {{MESS_NAME}} {{MESS_TIME}} coupon. send to same number?";
const replyCooldownSeconds = Number(process.env.REPLY_COOLDOWN_SECONDS || 0);
const showGroupsOnReady = parseBoolean(process.env.LOG_GROUPS_ON_READY, false);
let allowFromMe = runtimeOptions.allowFromMe;
let debugLogs = runtimeOptions.debugLogs;
const logAllGroupMessages = parseBoolean(process.env.LOG_ALL_GROUP_MESSAGES, false);
const controlEventMode = parseBoolean(process.env.CONTROL_EVENT_MODE, false);
const autoRestartOnDisconnect = parseBoolean(
  process.env.AUTO_RESTART_ON_DISCONNECT,
  true
);
const disableTerminalQr = parseBoolean(
  process.env.DISABLE_TERMINAL_QR,
  controlEventMode || process.env.NODE_ENV === "production"
);
const chromiumExtraArgs = parseCsv(process.env.CHROMIUM_EXTRA_ARGS);
const chromiumSingleProcess = parseBoolean(
  process.env.CHROMIUM_SINGLE_PROCESS,
  false
);
const restartDelayMs = Number(process.env.RESTART_DELAY_MS || 5000);
const dedupeCacheSize = Number(process.env.DEDUPE_CACHE_SIZE || 1000);
const maxRecentSenders = Number(process.env.MAX_RECENT_SENDERS || 5000);
const healthPort = Number(process.env.HEALTH_PORT || 0);
const keepaliveUrl = (process.env.KEEPALIVE_URL || "").trim();
const keepaliveIntervalSeconds = Number(
  process.env.KEEPALIVE_INTERVAL_SECONDS || 300
);
const qrHintDelayMs = Number(process.env.QR_HINT_DELAY_MS || 7000);
const quietMode = parseBoolean(process.env.QUIET_MODE, false);
const monitoringEnabledOnBoot = parseBoolean(
  process.env.MONITORING_ENABLED_ON_BOOT,
  false
);
let monitoringEnabled = controlEventMode ? monitoringEnabledOnBoot : true;

if (quietMode) {
  const originalLog = console.log.bind(console);
  console.log = (...args) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("__CONTROL_EVENT__")) {
      originalLog(...args);
    }
  };
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
}

if (
  activeMealModeInput !== activeMealMode &&
  activeMealModeInput !== "auto-time" &&
  activeMealModeInput !== "auto"
) {
  console.warn(
    `Invalid ACTIVE_MEAL_MODE="${activeMealModeInput}". Falling back to "all".`
  );
}

const runtimeState = {
  connected: false,
  lastReadyAt: null,
  lastMessageAt: null
};

function debugLog(...args) {
  if (!debugLogs) return;
  console.log("[debug]", ...args);
}

function emitControlEvent(type, payload = {}) {
  if (!controlEventMode) return;
  try {
    console.log(
      `__CONTROL_EVENT__${JSON.stringify({
        type,
        ts: new Date().toISOString(),
        ...payload
      })}`
    );
  } catch (_) {}
}

function oneLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function runtimeConfigSnapshot() {
  return {
    meal: activeMealMode,
    mess: allowedMessNames.join(","),
    allowFromMe,
    debugLogs
  };
}

function setMonitoringEnabled(enabled, reason = "manual") {
  monitoringEnabled = Boolean(enabled);
  const stateText = monitoringEnabled ? "enabled" : "disabled";
  console.log(`Monitoring ${stateText} (${reason}).`);
  emitControlEvent("monitoring_state", {
    enabled: monitoringEnabled,
    reason,
    config: runtimeConfigSnapshot()
  });
}

function applyRuntimeOverrides(config = {}) {
  if (!config || typeof config !== "object") return;

  if (Object.prototype.hasOwnProperty.call(config, "mess")) {
    allowedMessNames = resolveMessNames(
      config.mess,
      process.env.ALLOWED_MESS_NAMES || "neelkesh,firstman"
    );
  }

  if (Object.prototype.hasOwnProperty.call(config, "meal")) {
    activeMealMode = resolveMealMode(config.meal, new Date());
  }

  if (Object.prototype.hasOwnProperty.call(config, "allowFromMe")) {
    allowFromMe = parseBoolean(config.allowFromMe, allowFromMe);
  }

  if (Object.prototype.hasOwnProperty.call(config, "debugLogs")) {
    debugLogs = parseBoolean(config.debugLogs, debugLogs);
  }

  console.log("Runtime config updated:", runtimeConfigSnapshot());
  emitControlEvent("runtime_updated", {
    config: runtimeConfigSnapshot(),
    monitoringEnabled
  });
}

function setupControlCommandChannel() {
  if (!controlEventMode) return;
  if (!process.stdin) return;
  if (process.stdin.destroyed) return;

  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    inputBuffer += String(chunk || "");
    const parts = inputBuffer.split(/\r?\n/);
    inputBuffer = parts.pop() || "";

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let command = null;
      try {
        command = JSON.parse(trimmed);
      } catch (_) {
        console.error("Control command parse failed:", trimmed);
        continue;
      }

      const type = String(command?.type || "").toLowerCase();
      if (type === "set_runtime") {
        applyRuntimeOverrides(command.config || {});
        continue;
      }
      if (type === "set_monitoring") {
        setMonitoringEnabled(
          parseBoolean(command.enabled, false),
          "control_command"
        );
        continue;
      }
      if (type === "request_qr") {
        (async () => {
          try {
            const force = parseBoolean(command.force, false);
            runtimeState.connected = false;
            if (force) {
              try {
                await client.destroy();
              } catch (_) {}
              await sleep(750);
            }
            await initializeClient();
          } catch (error) {
            emitControlEvent("initialize_failed", {
              message: String(error?.message || error || "")
            });
          }
        })();
        continue;
      }
      if (type === "ping") {
        emitControlEvent("pong");
        continue;
      }
      console.warn("Unknown control command type:", command?.type);
    }
  });

  process.stdin.on("error", (error) => {
    console.error("Control command channel error:", error?.message || error);
  });

  emitControlEvent("control_channel_ready", {
    monitoringEnabled,
    config: runtimeConfigSnapshot()
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (allowedMessNames.length === 0) {
  console.error(
    "Missing ALLOWED_MESS_NAMES in .env. Example: ALLOWED_MESS_NAMES=neelkesh,firstman"
  );
  process.exit(1);
}

if (targetGroupIds.length === 0 && targetGroupNames.length === 0) {
  if (!showGroupsOnReady) {
    console.error(
      "Set at least one of TARGET_GROUP_IDS or TARGET_GROUP_NAMES in .env."
    );
    console.error(
      "Tip: set LOG_GROUPS_ON_READY=true to start in group-discovery mode."
    );
    process.exit(1);
  }

  console.log(
    "Group discovery mode: target groups are empty, so no auto-replies will be sent."
  );
}

const recentReplies = new Map();

function shouldReplyToSender(senderId) {
  if (!replyCooldownSeconds || replyCooldownSeconds <= 0) return true;

  const cooldownKey = extractPhoneNumber(senderId) || senderId;
  const now = Date.now();
  const last = recentReplies.get(cooldownKey) || 0;
  const cooldownMs = replyCooldownSeconds * 1000;
  const isAllowed = now - last >= cooldownMs;

  if (isAllowed) {
    recentReplies.set(cooldownKey, now);
    while (recentReplies.size > maxRecentSenders) {
      const oldestKey = recentReplies.keys().next().value;
      recentReplies.delete(oldestKey);
    }
  }
  return isAllowed;
}

function isAllowedGroup(chat) {
  const serializedId = chat?.id?._serialized || "";
  const chatName = (chat?.name || "").toLowerCase();

  if (targetGroupIds.includes(serializedId)) return true;
  if (targetGroupNameSet.has(chatName)) return true;
  return false;
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: process.env.CLIENT_ID || "coupon-bot",
    dataPath: process.env.AUTH_PATH || ".wwebjs_auth"
  }),
  puppeteer: {
    headless: runtimeOptions.resolvedHeadless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      "--metrics-recording-only",
      "--renderer-process-limit=1",
      "--no-zygote",
      ...(chromiumSingleProcess ? ["--single-process"] : []),
      ...chromiumExtraArgs
    ]
  }
});

let isInitializing = false;
let reconnectTimer = null;
let healthServer = null;
let keepaliveTimer = null;
let qrHintTimer = null;
const processedMessageIds = new Set();

async function initializeClient() {
  if (isInitializing) return;
  isInitializing = true;
  runtimeState.connected = false;
  console.log(`Initializing WhatsApp client (pid=${process.pid})...`);
  emitControlEvent("initializing");

  if (qrHintTimer) {
    clearTimeout(qrHintTimer);
    qrHintTimer = null;
  }
  qrHintTimer = setTimeout(() => {
    if (runtimeState.connected) return;
    console.log("Waiting for QR/session confirmation...");
    emitControlEvent("awaiting_qr");
  }, Math.max(1000, qrHintDelayMs));

  try {
    await client.initialize();
  } catch (error) {
    console.error("Initialize failed:", error);
    emitControlEvent("initialize_failed", {
      message: String(error?.message || error || "")
    });
    try {
      await client.destroy();
    } catch (_) {}
  } finally {
    if (qrHintTimer) {
      clearTimeout(qrHintTimer);
      qrHintTimer = null;
    }
    isInitializing = false;
  }
}

function scheduleReconnect(reason) {
  if (!autoRestartOnDisconnect) return;
  if (reconnectTimer) return;

  const normalized = String(reason || "").toUpperCase();
  if (normalized.includes("LOGOUT")) {
    console.log(
      "Session logged out. Reinitializing to generate a fresh QR for login."
    );
  }

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    console.log(`Attempting reconnect after disconnect (${reason})...`);
    try {
      await client.destroy();
    } catch (_) {}
    await sleep(750);
    await initializeClient();
  }, restartDelayMs);
}

function startHealthServer() {
  if (!healthPort || healthPort <= 0) return;
  if (healthServer) return;

  healthServer = http.createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        connected: runtimeState.connected,
        uptimeSeconds: Math.floor(process.uptime()),
        lastReadyAt: runtimeState.lastReadyAt,
        lastMessageAt: runtimeState.lastMessageAt
      })
    );
  });

  healthServer.on("error", (error) => {
    const code = String(error?.code || "");
    if (code === "EADDRINUSE") {
      console.error(
        `Health server port ${healthPort} already in use. Continuing without health endpoint.`
      );
      try {
        healthServer.close();
      } catch (_) {}
      healthServer = null;
      return;
    }
    console.error("Health server error:", error);
  });

  healthServer.listen(healthPort, () => {
    console.log(`Health server listening on port ${healthPort} (/health).`);
  });
}

function startKeepaliveLoop() {
  if (!keepaliveUrl) return;
  if (keepaliveTimer) return;

  const intervalMs = Math.max(30, keepaliveIntervalSeconds) * 1000;
  keepaliveTimer = setInterval(async () => {
    try {
      const response = await fetch(keepaliveUrl, { method: "GET" });
      debugLog("Keepalive ping ok", { keepaliveUrl, status: response.status });
    } catch (error) {
      console.error("Keepalive ping failed:", error?.message || error);
    }
  }, intervalMs);

  if (typeof keepaliveTimer.unref === "function") {
    keepaliveTimer.unref();
  }

  console.log(
    `Keepalive ping enabled: ${keepaliveUrl} every ${Math.max(
      30,
      keepaliveIntervalSeconds
    )}s`
  );
}

client.on("qr", (qr) => {
  if (qrHintTimer) {
    clearTimeout(qrHintTimer);
    qrHintTimer = null;
  }
  if (!disableTerminalQr) {
    console.log("\nScan this QR code with WhatsApp:\n");
    qrcode.generate(qr, { small: true });
  } else {
    console.log("QR received. Scan it from the control UI.");
  }
  emitControlEvent("qr", { qr });
});

client.on("authenticated", () => {
  if (qrHintTimer) {
    clearTimeout(qrHintTimer);
    qrHintTimer = null;
  }
  console.log("WhatsApp session authenticated.");
  runtimeState.connected = true;
  emitControlEvent("authenticated");
});

client.on("change_state", (state) => {
  const normalized = String(state || "").toUpperCase();
  debugLog("Client state changed:", normalized);
  emitControlEvent("wa_state", { state: normalized });
  if (normalized === "CONNECTED") {
    runtimeState.connected = true;
  }
});

client.on("ready", async () => {
  if (qrHintTimer) {
    clearTimeout(qrHintTimer);
    qrHintTimer = null;
  }
  console.log("Bot is ready and connected.");
  emitControlEvent("ready");
  runtimeState.connected = true;
  runtimeState.lastReadyAt = new Date().toISOString();
  debugLog("Config:", {
    allowFromMe,
    showGroupsOnReady,
    targetGroupIdsCount: targetGroupIds.length,
    targetGroupNamesCount: targetGroupNames.length,
    allowedMessNames,
    activeMealMode,
    cliOverrides: runtimeOptions.cli
  });

  if (!showGroupsOnReady) return;
  const maxAttempts = Number(process.env.GROUP_LIST_RETRY_ATTEMPTS || 3);
  const retryDelayMs = Number(process.env.GROUP_LIST_RETRY_DELAY_MS || 2000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const chats = await client.getChats();
      const groups = chats.filter((chat) => chat.isGroup);

      console.log("\nAvailable groups:");
      for (const group of groups) {
        console.log(`- ${group.name} => ${group.id._serialized}`);
      }
      console.log("");
      return;
    } catch (error) {
      console.error(
        `Failed to fetch group list (attempt ${attempt}/${maxAttempts}):`,
        error?.message || error
      );

      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  console.error(
    "Skipping group list after retries. Bot remains active for message handling."
  );
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failure:", msg);
  emitControlEvent("auth_failure", { message: String(msg || "") });
  scheduleReconnect("AUTH_FAILURE");
});

client.on("disconnected", (reason) => {
  if (qrHintTimer) {
    clearTimeout(qrHintTimer);
    qrHintTimer = null;
  }
  console.error("Client disconnected:", reason);
  emitControlEvent("disconnected", { reason: String(reason || "") });
  runtimeState.connected = false;
  scheduleReconnect(reason);
});

client.on("message_create", async (message) => {
  try {
    runtimeState.lastMessageAt = new Date().toISOString();

    if (!logAllGroupMessages) return;

    const chat = await message.getChat();
    if (!chat?.isGroup) return;

    const author =
      message.author ||
      message._data?.participant ||
      (message.fromMe ? client.info?.wid?._serialized : null) ||
      "unknown";

    console.log(
      `[group-msg] group="${chat.name}" groupId=${chat.id._serialized} fromMe=${
        message.fromMe
      } author=${author} body="${oneLine(message.body)}"`
    );
  } catch (error) {
    console.error("Group logger error:", error);
  }
});

async function handleIncomingMessage(message, source) {
  try {
    runtimeState.lastMessageAt = new Date().toISOString();

    if (!monitoringEnabled) {
      debugLog("Skip: monitoring disabled");
      return;
    }

    const messageId = message.id?._serialized || null;
    if (messageId && processedMessageIds.has(messageId)) {
      debugLog("Skip: duplicate message event", { source, messageId });
      return;
    }
    if (messageId) {
      processedMessageIds.add(messageId);
      while (processedMessageIds.size > dedupeCacheSize) {
        const oldest = processedMessageIds.values().next().value;
        processedMessageIds.delete(oldest);
      }
    }

    debugLog("Incoming message:", {
      source,
      id: message.id?._serialized,
      from: message.from,
      to: message.to,
      fromMe: message.fromMe,
      author: message.author || message._data?.participant || null,
      body: message.body || ""
    });

    if (message.fromMe && !allowFromMe) {
      debugLog("Skip: message.fromMe=true and ALLOW_FROM_ME=false");
      return;
    }

    const chat = await message.getChat();
    debugLog("Chat info:", {
      id: chat?.id?._serialized,
      name: chat?.name,
      isGroup: chat?.isGroup
    });
    if (!chat.isGroup) {
      debugLog("Skip: message is not from a group");
      return;
    }
    if (!isAllowedGroup(chat)) {
      debugLog("Skip: group not in TARGET_GROUP_IDS/TARGET_GROUP_NAMES", {
        chatId: chat.id._serialized,
        chatName: chat.name,
        targetGroupIds,
        targetGroupNames
      });
      return;
    }

    const body = message.body || "";
    const parserResult = parseCouponMessage({
      text: body,
      allowedMessNames,
      activeMealMode,
      messAliases
    });

    debugLog("Parser result:", {
      matched: parserResult.matched,
      sentence: parserResult.sentence,
      MESS_NAME: parserResult.MESS_NAME,
      MESS_TIME: parserResult.MESS_TIME,
      confidence: parserResult.confidence,
      reasons: parserResult.reasons
    });

    if (!parserResult.matched) {
      debugLog("Skip: parser did not match", {
        reasons: parserResult.reasons,
        body
      });
      return;
    }

    const extractedFields = {
      MESS_NAME: parserResult.MESS_NAME,
      MESS_TIME: parserResult.MESS_TIME
    };
    const matchedSentence = parserResult.sentence || body;

    const rawSenderId = message.fromMe
      ? client.info?.wid?._serialized
      : message.author || message._data?.participant || null;
    const senderCandidates = buildSenderCandidates(rawSenderId);
    const senderId = normalizeContactId(senderCandidates[0] || rawSenderId);
    debugLog("Sender resolution:", { rawSenderId, senderCandidates, senderId });
    if (!senderId || senderCandidates.length === 0) {
      console.log("Matched message but could not resolve sender ID.");
      return;
    }

    if (!shouldReplyToSender(senderId)) {
      console.log(`Cooldown active. Skipping auto-reply to ${senderId}`);
      debugLog("Skip: cooldown active", { senderId, replyCooldownSeconds });
      return;
    }

    const phone = extractPhoneNumber(senderId);
    const extractedFieldValues = Object.values(extractedFields).filter(Boolean);
    const templateValues = {
      phone,
      keyword: extractedFields.MESS_NAME || extractedFieldValues[0] || "",
      keywords: extractedFieldValues.join(", "),
      group: chat.name || chat.id._serialized,
      message: body
    };

    for (const [fieldName, fieldValue] of Object.entries(extractedFields)) {
      templateValues[fieldName] = fieldValue;
      templateValues[fieldName.toLowerCase()] = fieldValue;
    }

    const replyText = fillTemplate(replyTemplate, {
      ...templateValues
    });
    debugLog("Sending private message:", { senderCandidates, replyText });

    const deliveredTo = await sendMessageToFirstResolvableId(
      client,
      senderCandidates,
      replyText
    );

    console.log(
      `Sent private reply to ${deliveredTo} from group "${chat.name}" using sentence "${matchedSentence}" with parser fields ${JSON.stringify(
        extractedFields
      )} (confidence ${parserResult.confidence})`
    );
  } catch (error) {
    console.error("Error while processing message:", error);
  }
}

client.on("message", async (message) => {
  await handleIncomingMessage(message, "message");
});

client.on("message_create", async (message) => {
  if (!message.fromMe) return;
  await handleIncomingMessage(message, "message_create");
});

process.on("SIGINT", async () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  if (healthServer) {
    try {
      await new Promise((resolve) => healthServer.close(resolve));
    } catch (_) {}
  }
  try {
    await client.destroy();
  } catch (_) {}
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

startHealthServer();
startKeepaliveLoop();
setupControlCommandChannel();
if (controlEventMode) {
  setMonitoringEnabled(monitoringEnabled, "boot");
}
initializeClient();
