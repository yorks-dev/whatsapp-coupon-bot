const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveRuntimeOptions } = require("../src/runtime-options");
const { parseCouponMessage } = require("../src/parser");

test("runtime options + parser integration for lunch/neelkesh", () => {
  const runtime = resolveRuntimeOptions({
    env: {
      ALLOWED_MESS_NAMES: "neelkesh,firstman",
      ACTIVE_MEAL_MODE: "lunch"
    },
    argv: ["--meal", "lunch", "--mess", "neelkesh"]
  });

  const parsed = parseCouponMessage({
    text: "Seeling neelksh lunch coupon",
    allowedMessNames: runtime.allowedMessNames,
    activeMealMode: runtime.activeMealMode
  });

  assert.equal(parsed.matched, true);
  assert.equal(parsed.MESS_NAME, "neelkesh");
  assert.equal(parsed.MESS_TIME, "lunch");
});

test("buyer sentence should not match with same runtime config", () => {
  const runtime = resolveRuntimeOptions({
    env: {
      ALLOWED_MESS_NAMES: "neelkesh,firstman",
      ACTIVE_MEAL_MODE: "dinner"
    },
    argv: ["--meal", "dinner", "--mess", "firstman"]
  });

  const parsed = parseCouponMessage({
    text: "i want firstman dinner coupon",
    allowedMessNames: runtime.allowedMessNames,
    activeMealMode: runtime.activeMealMode
  });

  assert.equal(parsed.matched, false);
});
