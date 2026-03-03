"use strict";

function normalizeText(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(raw) {
  return String(raw || "")
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(raw) {
  return normalizeText(raw).split(" ").filter(Boolean);
}

function levenshteinDistance(a, b, maxDistance = Infinity) {
  const left = String(a || "");
  const right = String(b || "");

  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const n = left.length;
  const m = right.length;
  if (Math.abs(n - m) > maxDistance) return maxDistance + 1;

  let previous = new Array(m + 1);
  let current = new Array(m + 1);

  for (let j = 0; j <= m; j += 1) previous[j] = j;

  for (let i = 1; i <= n; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= m; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      if (current[j] < rowMin) rowMin = current[j];
    }

    if (rowMin > maxDistance) return maxDistance + 1;

    const temp = previous;
    previous = current;
    current = temp;
  }

  return previous[m];
}

function matchScore(token, candidate, maxDistance) {
  const dist = levenshteinDistance(token, candidate, maxDistance);
  const base = Math.max(token.length, candidate.length);
  if (!base) return { dist: 0, score: 1 };
  return { dist, score: Math.max(0, 1 - dist / base) };
}

function bestTokenMatch(tokens, candidates, options = {}) {
  const minScore = options.minScore ?? 0.65;
  const maxDistance = options.maxDistance ?? 2;
  const minTokenLen = options.minTokenLen ?? 3;

  let best = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.length < minTokenLen) continue;

    for (const candidate of candidates) {
      const effectiveMaxDistance =
        typeof maxDistance === "function"
          ? maxDistance(token, candidate)
          : maxDistance;
      const { dist, score } = matchScore(token, candidate, effectiveMaxDistance);

      if (dist > effectiveMaxDistance || score < minScore) continue;

      const item = {
        token,
        index: i,
        candidate,
        score,
        dist
      };

      if (!best) {
        best = item;
        continue;
      }

      if (item.score > best.score) {
        best = item;
        continue;
      }

      if (item.score === best.score && item.index < best.index) {
        best = item;
      }
    }
  }

  return best;
}

function looksLikeSelling(token) {
  if (!token) return false;
  if (token.startsWith("sell")) return true;

  const candidates = ["selling", "sell", "seling", "seeling", "sellng"];
  const found = bestTokenMatch([token], candidates, {
    minScore: 0.58,
    maxDistance: 3,
    minTokenLen: 4
  });
  return Boolean(found);
}

function hasSellerIntentAtStart(tokens) {
  if (!tokens.length) {
    return { ok: false, reason: "empty_text", score: 0 };
  }

  if (looksLikeSelling(tokens[0])) {
    return { ok: true, reason: "intent_start_direct", score: 1 };
  }

  // Accept: "i selling ...", "im selling ...", "i am selling ..."
  if (
    (tokens[0] === "i" || tokens[0] === "im") &&
    tokens[1] &&
    looksLikeSelling(tokens[1])
  ) {
    return { ok: true, reason: "intent_start_pronoun", score: 0.95 };
  }

  if (
    tokens[0] === "i" &&
    tokens[1] === "am" &&
    tokens[2] &&
    looksLikeSelling(tokens[2])
  ) {
    return { ok: true, reason: "intent_start_i_am", score: 0.95 };
  }

  return { ok: false, reason: "no_seller_intent_at_start", score: 0 };
}

function detectMeal(tokens) {
  const lunchMatch = bestTokenMatch(tokens, ["lunch"], {
    minScore: 0.7,
    maxDistance: 2,
    minTokenLen: 4
  });
  const dinnerMatch = bestTokenMatch(tokens, ["dinner"], {
    minScore: 0.72,
    maxDistance: 2,
    minTokenLen: 4
  });

  if (!lunchMatch && !dinnerMatch) return null;
  if (lunchMatch && !dinnerMatch) return { ...lunchMatch, meal: "lunch" };
  if (dinnerMatch && !lunchMatch) return { ...dinnerMatch, meal: "dinner" };
  return lunchMatch.score >= dinnerMatch.score
    ? { ...lunchMatch, meal: "lunch" }
    : { ...dinnerMatch, meal: "dinner" };
}

function detectMessName(tokens, allowedMessNames, aliases = {}) {
  const names = (allowedMessNames || [])
    .map((n) => normalizeText(n))
    .filter(Boolean);

  if (!names.length) return null;

  let best = null;

  for (const canonical of names) {
    const variants = [canonical, ...(aliases[canonical] || [])]
      .map((v) => normalizeText(v))
      .filter(Boolean);

    const hit = bestTokenMatch(tokens, variants, {
      minScore: 0.62,
      maxDistance: (token, candidate) => {
        const len = Math.max(token.length, candidate.length);
        if (len <= 6) return 2;
        if (len <= 10) return 3;
        return 4;
      },
      minTokenLen: 4
    });

    if (!hit) continue;

    const result = { ...hit, messName: canonical };
    if (!best || result.score > best.score) {
      best = result;
    }
  }

  return best;
}

function scoreConfidence(parts) {
  const weights = {
    intent: 0.4,
    mess: 0.35,
    meal: 0.25
  };

  const intentScore = parts.intent?.score ?? 0;
  const messScore = parts.mess?.score ?? 0;
  const mealScore = parts.meal?.score ?? 0;

  const weighted =
    intentScore * weights.intent +
    messScore * weights.mess +
    mealScore * weights.meal;

  return Number(Math.max(0, Math.min(1, weighted)).toFixed(3));
}

function parseSentence(sentence, options = {}) {
  const tokens = tokenize(sentence);
  const allowedMessNames =
    options.allowedMessNames && options.allowedMessNames.length
      ? options.allowedMessNames
      : ["neelkesh", "firstman"];
  const aliases = options.messAliases || {};
  const activeMealMode = (options.activeMealMode || "").toLowerCase();

  const reasons = [];
  const intent = hasSellerIntentAtStart(tokens);
  if (!intent.ok) {
    reasons.push(intent.reason);
  }

  const mess = detectMessName(tokens, allowedMessNames, aliases);
  if (!mess) reasons.push("missing_mess_name");

  let meal = detectMeal(tokens);
  if (!meal && (activeMealMode === "lunch" || activeMealMode === "dinner")) {
    meal = { meal: activeMealMode, score: 0.55, source: "active_mode_fallback" };
    reasons.push("meal_fallback_from_active_mode");
  }
  if (!meal) reasons.push("missing_meal");

  const matched = Boolean(intent.ok && mess && meal);
  const confidence = scoreConfidence({
    intent: { score: intent.score },
    mess: mess ? { score: mess.score } : null,
    meal
  });

  return {
    matched,
    MESS_NAME: mess?.messName || null,
    MESS_TIME: meal?.meal || null,
    confidence,
    reasons,
    debug: {
      tokens,
      intent,
      mess,
      meal
    }
  };
}

function parseCouponMessage(input = {}) {
  const text = String(input.text || "");
  const sentences = splitSentences(text);
  if (!sentences.length) {
    return {
      matched: false,
      MESS_NAME: null,
      MESS_TIME: null,
      confidence: 0,
      reasons: ["empty_text"],
      sentence: "",
      debug: {}
    };
  }

  const results = sentences.map((sentence) => ({
    sentence,
    ...parseSentence(sentence, input)
  }));

  const matchedResults = results.filter((r) => r.matched);
  if (matchedResults.length > 0) {
    matchedResults.sort((a, b) => b.confidence - a.confidence);
    return matchedResults[0];
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results[0];
}

module.exports = {
  normalizeText,
  tokenize,
  splitSentences,
  levenshteinDistance,
  parseSentence,
  parseCouponMessage
};
