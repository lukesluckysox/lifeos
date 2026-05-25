/**
 * Pure financial indicator math. NO I/O, NO Express, NO process state.
 *
 * Everything here is deterministic and unit-testable. The route handler in
 * `server/routes/finance.ts` fetches the Yahoo close series and then runs it
 * through `analyzeSeries()` below.
 *
 * Keeping the math here lets us verify it against known fixtures (Wilder RSI
 * reference values, simple drawdown cases, sentiment thresholds) without
 * mocking HTTP.
 */

export type SentimentLabel =
  | "Strong Buy"
  | "Buy"
  | "Hold"
  | "Sell"
  | "Strong Sell";

export interface SignalReason {
  tag: string;
  weight: number;
  detail?: string;
}

export interface Factors {
  momentum: number | null;
  trend: number | null;
  drawdown: number | null;
  rsi: number | null;
  rsiSignal: number | null;
  volatilityPct: number | null;
  sharpe: number | null;
}

export interface SeriesAnalysis {
  currentPrice: number | null;
  returnPct: number | null;
  sentiment: number;
  label: SentimentLabel;
  reasons: SignalReason[];
  factors: Factors;
  action: string;
  conviction: 1 | 2 | 3;
}

export function clamp(n: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Composite score → label thresholds. Single source of truth. */
export function scoreToLabel(s: number): SentimentLabel {
  if (s >= 0.6) return "Strong Buy";
  if (s >= 0.2) return "Buy";
  if (s > -0.2) return "Hold";
  if (s > -0.6) return "Sell";
  return "Strong Sell";
}

/** Simple moving average over the last `n` values. Returns null if too short. */
export function sma(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}

/**
 * Wilder's RSI(n).
 *
 * Classic formulation: seed with simple averages of gains/losses over the
 * first `n` deltas, then smooth recursively for the remainder.
 * Returns 100 if avg loss == 0 (textbook behavior).
 */
export function rsi(arr: number[], n = 14): number | null {
  if (arr.length <= n) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= n; i++) {
    const d = arr[i] - arr[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / n;
  let avgL = losses / n;
  for (let i = n + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (n - 1) + g) / n;
    avgL = (avgL * (n - 1) + l) / n;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

/** Annualized stdev of daily returns, in percent (252 trading days). */
export function dailyVolPct(arr: number[]): number | null {
  if (arr.length < 5) return null;
  const rets: number[] = [];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1] > 0) rets.push((arr[i] - arr[i - 1]) / arr[i - 1]);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance =
    rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/**
 * Drawdown of `last` price relative to the maximum in `series`, as a signed
 * percentage <= 0. At-high → 0, 50% off-high → -50.
 */
export function drawdownPct(series: number[], last: number): number {
  if (!series.length) return 0;
  const high = series.reduce((m, c) => (c > m ? c : m), -Infinity);
  return high > 0 ? ((last - high) / high) * 100 : 0;
}

/** Smooth a return % into a momentum factor in [-1, +1]. */
export function returnPctToMomentum(pct: number): number {
  return clamp(Math.tanh(pct / 20));
}

function buildActionLine(label: SentimentLabel, factors: Factors): string {
  const { rsi: rsiV, trend, drawdown, momentum } = factors;
  const overbought = rsiV != null && rsiV >= 70;
  const oversold = rsiV != null && rsiV <= 30;
  const aboveTrend = (trend ?? 0) > 0.1;
  const belowTrend = (trend ?? 0) < -0.1;
  const farOffHigh = (drawdown ?? 0) < -0.4;
  const momentumUp = (momentum ?? 0) > 0.3;
  const momentumDown = (momentum ?? 0) < -0.3;

  if (label === "Strong Buy") {
    if (oversold) return "Accumulate — beaten down, oversold, mean-reversion setup.";
    if (aboveTrend && momentumUp) return "Add on weakness — trend intact, momentum durable.";
    return "Accumulate — multiple factors lining up bullish.";
  }
  if (label === "Buy") {
    if (aboveTrend) return "Lean in — above the 50-day, breathing room before overbought.";
    if (oversold) return "Probe a starter — oversold but trend hasn't confirmed yet.";
    return "Lean in modestly — signals tilt positive, not euphoric.";
  }
  if (label === "Sell") {
    if (overbought) return "Trim — extended on RSI, risk/reward is asymmetric here.";
    if (belowTrend && momentumDown) return "Lighten up — below the 50-day, momentum has rolled.";
    return "Tighten the leash — factors tilting unfavorable.";
  }
  if (label === "Strong Sell") {
    if (overbought && farOffHigh) return "Take profits — exhausted move and structural damage.";
    if (belowTrend) return "Cut size — trend broken, no factor defending it.";
    return "Reduce — broad-based deterioration.";
  }
  if (overbought) return "Hold but don't add — overbought without trend rolling yet.";
  if (oversold) return "Hold and watch — oversold but no reversal signal yet.";
  if (farOffHigh) return "Hold — well off the highs, waiting for a base.";
  return "Hold — mixed signals, no edge either way.";
}

const FACTOR_WEIGHTS = {
  momentum: 0.35,
  trend: 0.25,
  drawdown: 0.15,
  rsiSignal: 0.25,
} as const;

/**
 * Run the full multi-factor sentiment analysis on a daily close series.
 *
 * @param closesAll    Full daily close history (length ≥ ~30 ideal).
 * @param windowLen    Trading-day lookback window for return/drawdown.
 * @param latestPrice  Optional override for the latest price (e.g.
 *                     intraday `regularMarketPrice`). Defaults to last close.
 */
export function analyzeSeries(
  closesAll: number[],
  windowLen: number,
  latestPrice?: number
): SeriesAnalysis {
  if (!closesAll.length) {
    return {
      currentPrice: null,
      returnPct: null,
      sentiment: 0,
      label: "Hold",
      reasons: [],
      factors: {
        momentum: null,
        trend: null,
        drawdown: null,
        rsi: null,
        rsiSignal: null,
        volatilityPct: null,
        sharpe: null,
      },
      action: "No data available.",
      conviction: 1,
    };
  }

  const tradingDays = Math.max(5, Math.round(windowLen));
  const sliced = closesAll.slice(
    Math.max(0, closesAll.length - tradingDays)
  );
  const first = sliced[0];
  const last = latestPrice ?? sliced[sliced.length - 1];
  const returnPct = first > 0 ? ((last - first) / first) * 100 : 0;

  const momentum = returnPctToMomentum(returnPct);

  const sma50 = sma(closesAll, 50);
  const trendPct = sma50 ? ((last - sma50) / sma50) * 100 : null;
  const trend = trendPct != null ? clamp(Math.tanh(trendPct / 8)) : null;

  const dd = drawdownPct(sliced, last);
  const drawdown = clamp(Math.tanh(dd / 20));

  const rsiV = rsi(closesAll, 14);
  const rsiSignal = rsiV != null ? clamp((50 - rsiV) / 25) : null;

  const volatilityPct = dailyVolPct(sliced);
  const sharpe =
    volatilityPct && volatilityPct > 0 ? returnPct / volatilityPct : null;

  // Composite (weighted average of available factors)
  const factorMap: Record<keyof typeof FACTOR_WEIGHTS, number | null> = {
    momentum,
    trend,
    drawdown,
    rsiSignal,
  };
  let num = 0;
  let den = 0;
  for (const [k, w] of Object.entries(FACTOR_WEIGHTS) as [
    keyof typeof FACTOR_WEIGHTS,
    number
  ][]) {
    const v = factorMap[k];
    if (v != null && Number.isFinite(v)) {
      num += v * w;
      den += w;
    }
  }
  const composite = den > 0 ? clamp(num / den) : 0;

  // Reasons (top 3 strongest signed factors)
  const reasons: SignalReason[] = [];
  if (rsiV != null) {
    if (rsiV >= 70)
      reasons.push({
        tag: `RSI ${rsiV.toFixed(0)} · overbought`,
        weight: -((rsiV - 70) / 30),
        detail: "RSI above 70 historically precedes pullbacks.",
      });
    else if (rsiV <= 30)
      reasons.push({
        tag: `RSI ${rsiV.toFixed(0)} · oversold`,
        weight: (30 - rsiV) / 30,
        detail: "RSI below 30 often marks mean-reversion setups.",
      });
  }
  if (trendPct != null) {
    if (trendPct >= 3)
      reasons.push({
        tag: `+${trendPct.toFixed(1)}% above 50-day`,
        weight: clamp(trendPct / 15),
        detail: "Trading above the 50-day SMA — uptrend intact.",
      });
    else if (trendPct <= -3)
      reasons.push({
        tag: `${trendPct.toFixed(1)}% below 50-day`,
        weight: clamp(trendPct / 15),
        detail: "Below the 50-day SMA — downtrend in force.",
      });
  }
  if (Math.abs(returnPct) >= 5) {
    reasons.push({
      tag: `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}% this window`,
      weight: momentum,
      detail: "Total return over the active lookback.",
    });
  }
  if (dd <= -10) {
    reasons.push({
      tag: `${dd.toFixed(0)}% off window high`,
      weight: drawdown,
      detail: "Distance from the highest close in the window.",
    });
  }
  if (sharpe != null && Math.abs(sharpe) >= 0.5) {
    reasons.push({
      tag: `${sharpe >= 0 ? "+" : ""}${sharpe.toFixed(2)} return/vol`,
      weight: clamp(sharpe / 3),
      detail:
        "Mini risk-adjusted return — return divided by annualized volatility.",
    });
  }
  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const topReasons = reasons.slice(0, 3);

  const label = scoreToLabel(composite);
  const factors: Factors = {
    momentum,
    trend,
    drawdown,
    rsi: rsiV,
    rsiSignal,
    volatilityPct,
    sharpe,
  };
  const action = buildActionLine(label, factors);
  const absScore = Math.abs(composite);
  const conviction: 1 | 2 | 3 = absScore >= 0.6 ? 3 : absScore >= 0.3 ? 2 : 1;

  return {
    currentPrice: last,
    returnPct,
    sentiment: composite,
    label,
    reasons: topReasons,
    factors,
    action,
    conviction,
  };
}
