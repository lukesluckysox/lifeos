/**
 * Pure-math tests for the sentiment engine.
 *
 * Run: `npm test` (uses Node's built-in test runner via tsx).
 *
 * These tests deliberately use small, hand-traceable fixtures rather than
 * recorded Yahoo data so failures point at the math, not the network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rsi,
  sma,
  drawdownPct,
  dailyVolPct,
  returnPctToMomentum,
  scoreToLabel,
  analyzeSeries,
} from "../finance/indicators";

describe("scoreToLabel — threshold boundaries", () => {
  it("maps composite scores to the right labels at the boundaries", () => {
    assert.equal(scoreToLabel(1.0), "Strong Buy");
    assert.equal(scoreToLabel(0.6), "Strong Buy");
    assert.equal(scoreToLabel(0.59), "Buy");
    assert.equal(scoreToLabel(0.2), "Buy");
    assert.equal(scoreToLabel(0.19), "Hold");
    assert.equal(scoreToLabel(0), "Hold");
    assert.equal(scoreToLabel(-0.19), "Hold");
    assert.equal(scoreToLabel(-0.2), "Sell");
    assert.equal(scoreToLabel(-0.59), "Sell");
    assert.equal(scoreToLabel(-0.6), "Strong Sell");
    assert.equal(scoreToLabel(-1.0), "Strong Sell");
  });
});

describe("rsi — Wilder", () => {
  it("returns null when the series is shorter than the lookback", () => {
    assert.equal(rsi([1, 2, 3], 14), null);
  });

  it("returns 100 when there are no down days (textbook behavior)", () => {
    // Strictly monotonically increasing — avgL = 0 → RSI = 100.
    const arr = Array.from({ length: 30 }, (_, i) => 100 + i);
    const v = rsi(arr, 14);
    assert.equal(v, 100);
  });

  it("sits near 50 when gains and losses are perfectly balanced", () => {
    // Alternating +1, -1 → avgG ≈ avgL. Wilder smoothing with a seeded window
    // won’t hit exactly 50 because the seed depends on which side of the alternation
    // it lands on, but it should converge to a tight band around it.
    const arr: number[] = [100];
    for (let i = 0; i < 40; i++) arr.push(arr[arr.length - 1] + (i % 2 === 0 ? 1 : -1));
    const v = rsi(arr, 14);
    assert.ok(v !== null);
    assert.ok(Math.abs(v! - 50) < 5, `expected within 5 of 50, got ${v}`);
  });

  it("falls below 50 when losses dominate", () => {
    // Strong downtrend → RSI well below 50.
    const arr = Array.from({ length: 30 }, (_, i) => 100 - i);
    const v = rsi(arr, 14);
    assert.ok(v !== null);
    assert.ok(v! < 20, `expected RSI < 20 on monotonic downtrend, got ${v}`);
  });
});

describe("sma + drawdown", () => {
  it("sma averages the last n values exactly", () => {
    assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
    assert.equal(sma([10, 20, 30], 2), 25);
    assert.equal(sma([1, 2], 5), null);
  });

  it("drawdownPct is 0 at the high and negative off the high", () => {
    assert.equal(drawdownPct([10, 20, 30], 30), 0);
    assert.equal(drawdownPct([10, 20, 30], 15), -50);
    // last > high (intraday breakout) → drawdown is positive — function
    // doesn't clamp on purpose; the caller decides if that's "at high".
    assert.equal(drawdownPct([10, 20, 30], 60), 100);
  });
});

describe("dailyVolPct + returnPctToMomentum", () => {
  it("vol is null for too-short series", () => {
    assert.equal(dailyVolPct([100, 101]), null);
  });

  it("vol is finite and positive for a noisy series", () => {
    const arr = [100, 102, 99, 103, 98, 105, 100, 104, 99, 106];
    const v = dailyVolPct(arr);
    assert.ok(v !== null);
    assert.ok(v! > 0);
  });

  it("momentum saturates near ±1 at large returns and is monotonic", () => {
    assert.ok(returnPctToMomentum(100) > 0.99);
    assert.ok(returnPctToMomentum(-100) < -0.99);
    assert.equal(returnPctToMomentum(0), 0);
    assert.ok(returnPctToMomentum(10) > returnPctToMomentum(5));
    assert.ok(returnPctToMomentum(-10) < returnPctToMomentum(-5));
  });
});

describe("analyzeSeries — end-to-end sentiment", () => {
  it("strong uptrend → positive composite + above-trend reasoning", () => {
    // 60-day monotonic uptrend: long enough for SMA50 + RSI(14) to be defined.
    // A perfect uptrend pegs RSI at 100 which the engine reads as overbought
    // (intentional — trims the composite). What we *do* care about is that
    // trend + momentum factors are bullish and the composite is positive.
    const arr = Array.from({ length: 60 }, (_, i) => 100 * (1 + i * 0.005));
    const out = analyzeSeries(arr, 30);
    assert.ok(out.sentiment > 0, `composite should be positive, got ${out.sentiment}`);
    assert.ok((out.factors.trend ?? 0) > 0.3, "trend factor should be strongly positive");
    assert.ok((out.factors.momentum ?? 0) > 0.3, "momentum factor should be strongly positive");
    // And the most prominent positive reason should be the 50-day breakout.
    assert.ok(
      out.reasons.some((r) => r.tag.includes("above 50-day")),
      "expected an 'above 50-day' reason in the top reasons"
    );
  });

  it("monotonic downtrend → Sell or Strong Sell", () => {
    const arr = Array.from({ length: 60 }, (_, i) => 100 * (1 - i * 0.005));
    const out = analyzeSeries(arr, 30);
    assert.ok(
      out.label === "Sell" || out.label === "Strong Sell",
      `expected Sell/Strong Sell on monotonic downtrend, got ${out.label}`
    );
    assert.ok(out.sentiment < -0.2);
  });

  it("flat series → low conviction regardless of label", () => {
    // A perfectly flat series has trend=0, momentum=0, drawdown=0, but the
    // Wilder RSI hits 100 (no down days at all), which biases the composite
    // toward “overbought.” That’s consistent with the existing engine —
    // we just want to assert that conviction stays at 1 (low) because no
    // factor is strongly signed in either direction in absolute terms.
    const arr = Array.from({ length: 60 }, () => 100);
    const out = analyzeSeries(arr, 30);
    assert.equal(out.conviction, 1);
    assert.equal(out.factors.trend, 0);
    assert.equal(out.factors.momentum, 0);
  });

  it("empty input is handled gracefully", () => {
    const out = analyzeSeries([], 30);
    assert.equal(out.label, "Hold");
    assert.equal(out.currentPrice, null);
    assert.equal(out.returnPct, null);
  });

  it("conviction tiering matches composite magnitude", () => {
    // Hand-build a series that produces a strong negative score.
    const arr = Array.from({ length: 60 }, (_, i) => 100 - i * 1.5);
    const out = analyzeSeries(arr, 30);
    if (Math.abs(out.sentiment) >= 0.6) assert.equal(out.conviction, 3);
    else if (Math.abs(out.sentiment) >= 0.3) assert.equal(out.conviction, 2);
    else assert.equal(out.conviction, 1);
  });
});
