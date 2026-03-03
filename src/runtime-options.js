"use strict";

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "y", "on"].includes(String(value).toLowerCase());
}

function parseJsonObject(raw, fallback = {}) {
  if (!raw || !String(raw).trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return fallback;
  } catch (_) {
    return fallback;
  }
}

function parseCliArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const parsed = {};

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token || !token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = args[i + 1];

    if (next !== undefined && !String(next).startsWith("--")) {
      parsed[key] = String(next);
      i += 1;
      continue;
    }

    parsed[key] = "true";
  }

  return parsed;
}

function resolveMealMode(rawMode, now = new Date()) {
  const mode = String(rawMode || "all").trim().toLowerCase();
  if (mode === "lunch" || mode === "dinner" || mode === "all") return mode;

  // Backward compatibility: auto-time resolves to current meal.
  if (mode === "auto-time") {
    const hour = now.getHours();
    return hour >= 11 && hour < 18 ? "lunch" : "dinner";
  }

  // Backward compatibility: legacy "auto" now means "all".
  if (mode === "auto") return "all";

  return "all";
}

function resolveMessNames(rawMess, fallbackCsv = "neelkesh,firstman") {
  const raw = String(rawMess || "").trim().toLowerCase();
  const fallback = parseCsv(fallbackCsv).map((name) => name.toLowerCase());

  if (!raw) return fallback;
  if (raw === "all") return fallback;

  const parsed = parseCsv(raw).map((name) => name.toLowerCase());
  return parsed.length ? parsed : fallback;
}

function resolveRuntimeOptions({
  env = process.env,
  argv = process.argv.slice(2),
  now = new Date()
} = {}) {
  const cli = parseCliArgs(argv);

  const defaultMessCsv = env.ALLOWED_MESS_NAMES || "neelkesh,firstman";
  const allowedMessNames = cli.mess
    ? resolveMessNames(cli.mess, "neelkesh,firstman")
    : resolveMessNames("", defaultMessCsv);

  const mealInput = cli.meal ?? env.ACTIVE_MEAL_MODE ?? "all";
  const activeMealMode = resolveMealMode(mealInput, now);

  const resolvedHeadless = parseBoolean(cli.headless ?? env.HEADLESS, true);
  const allowFromMe = parseBoolean(cli["allow-from-me"] ?? env.ALLOW_FROM_ME, false);
  const debugLogs = parseBoolean(cli.debug ?? env.DEBUG_LOGS, false);

  return {
    cli,
    allowedMessNames,
    activeMealModeInput: String(mealInput).toLowerCase(),
    activeMealMode,
    resolvedHeadless,
    allowFromMe,
    debugLogs
  };
}

module.exports = {
  parseCsv,
  parseBoolean,
  parseJsonObject,
  parseCliArgs,
  resolveMealMode,
  resolveMessNames,
  resolveRuntimeOptions
};
