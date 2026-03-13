const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCouponMessage } = require("../src/parser");

test("matches standard neelkesh lunch sentence", () => {
  const result = parseCouponMessage({
    text: "selling neelkesh lunch coupon",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, true);
  assert.equal(result.MESS_NAME, "neelkesh");
  assert.equal(result.MESS_TIME, "lunch");
});

test("matches without coupon token", () => {
  const result = parseCouponMessage({
    text: "selling neelkesh lunch",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, true);
  assert.equal(result.MESS_NAME, "neelkesh");
  assert.equal(result.MESS_TIME, "lunch");
});

test("matches typo-heavy sentence", () => {
  const result = parseCouponMessage({
    text: "Seeling neelksh lunch caupan",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, true);
  assert.equal(result.MESS_NAME, "neelkesh");
  assert.equal(result.MESS_TIME, "lunch");
});

test("rejects when meal is missing (strict mode)", () => {
  const result = parseCouponMessage({
    text: "selling neelkesh coupon",
    activeMealMode: "dinner",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, false);
  assert.ok(result.reasons.includes("missing_meal"));
});

test("rejects when detected meal mismatches active mode", () => {
  const result = parseCouponMessage({
    text: "selling neelkesh lunch coupon",
    activeMealMode: "dinner",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, false);
  assert.ok(result.reasons.includes("meal_mismatch_active_mode"));
});

test("rejects buyer-style sentence", () => {
  const result = parseCouponMessage({
    text: "i want neelkesh lunch coupon",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, false);
  assert.ok(result.reasons.includes("no_seller_intent_at_start"));
});

test("rejects anyone selling style sentence", () => {
  const result = parseCouponMessage({
    text: "anyone selling neelkesh lunch coupon?",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, false);
  assert.ok(result.reasons.includes("no_seller_intent_at_start"));
});

test("matches firstman dinner", () => {
  const result = parseCouponMessage({
    text: "i am selling firstman dinner coupon",
    allowedMessNames: ["neelkesh", "firstman"]
  });

  assert.equal(result.matched, true);
  assert.equal(result.MESS_NAME, "firstman");
  assert.equal(result.MESS_TIME, "dinner");
});
