const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseCliArgs,
  resolveMealMode,
  resolveMessNames,
  resolveRuntimeOptions
} = require("../src/runtime-options");

test("parseCliArgs parses key-value and bool flags", () => {
  const parsed = parseCliArgs([
    "--meal",
    "lunch",
    "--mess",
    "neelkesh",
    "--debug"
  ]);
  assert.equal(parsed.meal, "lunch");
  assert.equal(parsed.mess, "neelkesh");
  assert.equal(parsed.debug, "true");
});

test("resolveMealMode supports auto-time", () => {
  const lunchTime = new Date("2026-03-03T13:00:00+05:30");
  const dinnerTime = new Date("2026-03-03T21:00:00+05:30");
  assert.equal(resolveMealMode("all", lunchTime), "all");
  assert.equal(resolveMealMode("auto-time", lunchTime), "lunch");
  assert.equal(resolveMealMode("auto-time", dinnerTime), "dinner");
  assert.equal(resolveMealMode("auto"), "all");
});

test("resolveMessNames supports all and csv", () => {
  assert.deepEqual(resolveMessNames("all"), ["neelkesh", "firstman"]);
  assert.deepEqual(resolveMessNames("firstman"), ["firstman"]);
  assert.deepEqual(resolveMessNames("neelkesh,firstman"), [
    "neelkesh",
    "firstman"
  ]);
});

test("resolveRuntimeOptions prioritizes cli over env", () => {
  const resolved = resolveRuntimeOptions({
    env: {
      ALLOWED_MESS_NAMES: "firstman",
      ACTIVE_MEAL_MODE: "dinner",
      HEADLESS: "true",
      ALLOW_FROM_ME: "false",
      DEBUG_LOGS: "false"
    },
    argv: ["--meal", "lunch", "--mess", "neelkesh"]
  });

  assert.equal(resolved.activeMealMode, "lunch");
  assert.deepEqual(resolved.allowedMessNames, ["neelkesh"]);
  assert.equal(resolved.allowFromMe, false);
});

test("resolveRuntimeOptions treats --mess all as full catalog", () => {
  const resolved = resolveRuntimeOptions({
    env: {
      ALLOWED_MESS_NAMES: "neelkesh"
    },
    argv: ["--mess", "all"]
  });

  assert.deepEqual(resolved.allowedMessNames, ["neelkesh", "firstman"]);
});
