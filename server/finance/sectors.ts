/**
 * Sector universe + bucketing + optimal-allocation math.
 *
 * Everything in this file is deterministic. Live sector lookup (Yahoo
 * quoteSummary) lives in `server/routes/finance.ts` and writes into the
 * 24h cache; the math here just operates on already-resolved sectors.
 */

export const SECTOR_UNIVERSE: Record<string, string[]> = {
  Tech: ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AMD", "ORCL", "CRM"],
  Finance: ["JPM", "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "V", "MA", "AXP"],
  Healthcare: ["LLY", "UNH", "JNJ", "ABBV", "PFE", "MRK", "TMO", "ABT", "DHR", "ISRG"],
  Consumer: ["WMT", "COST", "HD", "NKE", "MCD", "SBUX", "PG", "KO", "PEP", "DIS"],
  Energy: ["XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX", "MPC", "VLO", "HES"],
  Crypto: ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "MATIC"],
};

export const CANONICAL_SECTORS = Object.keys(SECTOR_UNIVERSE);

/** Symbol → canonical sector, derived from SECTOR_UNIVERSE. */
export const SYMBOL_TO_SECTOR_CURATED: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [sector, syms] of Object.entries(SECTOR_UNIVERSE)) {
    for (const s of syms) m[s.toUpperCase()] = sector;
  }
  return m;
})();

/** ETF / broad-market hints — no API call needed. */
export const ETF_SECTOR_HINTS: Record<string, string> = {
  SPY: "Broad Market", VOO: "Broad Market", VTI: "Broad Market", IVV: "Broad Market",
  QQQ: "Tech", QQQM: "Tech", XLK: "Tech", VGT: "Tech", SMH: "Tech", SOXX: "Tech", SOXL: "Tech",
  XLF: "Finance", VFH: "Finance",
  XLV: "Healthcare", VHT: "Healthcare",
  XLY: "Consumer", XLP: "Consumer", VCR: "Consumer", VDC: "Consumer",
  XLE: "Energy", VDE: "Energy",
  XLI: "Industrials", VIS: "Industrials",
  XLU: "Utilities", VPU: "Utilities",
  XLB: "Materials", VAW: "Materials",
  XLRE: "Real Estate", VNQ: "Real Estate",
  XLC: "Communications", VOX: "Communications",
  DIA: "Broad Market", IWM: "Broad Market",
  VXUS: "International", EFA: "International", EEM: "International",
  BND: "Bonds", AGG: "Bonds", TLT: "Bonds", IEF: "Bonds", SHY: "Bonds",
  GLD: "Commodities", SLV: "Commodities", USO: "Commodities", DBC: "Commodities",
};

/** Crypto sniff — symbols that are unambiguously crypto without API confirm. */
export function isCryptoSymbol(sym: string): boolean {
  if (sym.endsWith("-USD")) return true;
  return /^(BTC|ETH|SOL|XRP|ADA|DOGE|AVAX|LINK|DOT|MATIC)$/.test(sym);
}

/** Yahoo Finance sector string → our normalized bucket. */
export function normalizeYahooSector(raw: string | null | undefined): string {
  if (!raw) return "Other";
  const s = raw.toLowerCase();
  if (s.includes("technology")) return "Tech";
  if (s.includes("financial")) return "Finance";
  if (s.includes("health")) return "Healthcare";
  if (s.includes("consumer")) return "Consumer";
  if (s.includes("energy")) return "Energy";
  if (s.includes("industrial")) return "Industrials";
  if (s.includes("utilit")) return "Utilities";
  if (s.includes("material") || s.includes("basic")) return "Materials";
  if (s.includes("real estate")) return "Real Estate";
  if (s.includes("communication")) return "Communications";
  return raw;
}

/** Crypto symbols on Yahoo Finance are quoted as `<TICKER>-USD`. */
export function yahooSymbol(sym: string, sector: string): string {
  if (sector === "Crypto") return `${sym}-USD`;
  return sym;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimal allocation — pure
// ─────────────────────────────────────────────────────────────────────────────

export interface ValuedHolding {
  symbol: string;
  value: number;
  /** Pre-resolved canonical sector (or "Other" / non-canonical). */
  sector: string;
}

export interface SectorReturn {
  name: string;
  returnPct: number | null;
  leader: string | null;
}

export interface OptimalLane {
  sector: string;
  currentWeight: number;
  currentValue: number;
  optimalWeight: number;
  deltaWeight: number;
  sectorReturnPct: number | null;
  leader: string | null;
  symbols: string[];
  action: string | null;
}

export interface OptimalAllocation {
  lanes: OptimalLane[];
  otherWeight: number;
  otherValue: number;
  otherSymbols: string[];
  totalValue: number;
}

/**
 * Build the optimal allocation across canonical lanes.
 *
 * Inputs are pre-resolved (sectors already looked up, sector returns already
 * fetched) so this stays I/O-free and easy to test.
 *
 * Guarantees:
 *   - `lanes` covers every canonical sector exactly once, in canonical order.
 *   - Sum of `optimalWeight` across lanes is 1.0 (within float tolerance) —
 *     `otherWeight` is reported separately for the donut to total 100%.
 *   - All `currentWeight` + `otherWeight` sums to 1.0 when totalValue > 0.
 */
export function computeOptimalAllocation(
  holdings: ValuedHolding[],
  sectorReturns: SectorReturn[],
  canonical: string[] = CANONICAL_SECTORS
): OptimalAllocation {
  const sectorValue: Record<string, number> = {};
  const sectorSymbols: Record<string, string[]> = {};
  let totalValue = 0;
  let otherValue = 0;
  const otherSymbols: string[] = [];

  for (const h of holdings) {
    if (!h?.symbol || !Number.isFinite(h.value) || h.value <= 0) continue;
    const sym = String(h.symbol).toUpperCase();
    totalValue += h.value;
    if (canonical.includes(h.sector)) {
      sectorValue[h.sector] = (sectorValue[h.sector] ?? 0) + h.value;
      (sectorSymbols[h.sector] = sectorSymbols[h.sector] ?? []).push(sym);
    } else {
      otherValue += h.value;
      otherSymbols.push(sym);
    }
  }

  // Lane skeleton
  const lanes = canonical.map((name) => {
    const sr = sectorReturns.find((x) => x.name === name);
    const value = sectorValue[name] ?? 0;
    const currentWeight = totalValue > 0 ? value / totalValue : 0;
    return {
      sector: name,
      currentWeight,
      currentValue: value,
      symbols: sectorSymbols[name] ?? [],
      sectorReturnPct: sr?.returnPct ?? null,
      leader: sr?.leader ?? null,
    };
  });

  // Score = max(returnPct, 0) + 1 — losers keep a baseline of 1 so the book
  // stays diversified even when the whole tape is red.
  const scored = lanes.map((l) => ({
    ...l,
    score: Math.max(l.sectorReturnPct ?? 0, 0) + 1,
  }));
  const totalScore = scored.reduce((s, x) => s + x.score, 0) || 1;

  const out: OptimalLane[] = scored.map((l) => {
    const optimalWeight = l.score / totalScore;
    const delta = optimalWeight - l.currentWeight;
    let action: string | null = null;
    if (l.currentWeight === 0 && (l.sectorReturnPct ?? 0) > 5) {
      action = `Add exposure — sector +${(l.sectorReturnPct ?? 0).toFixed(1)}%${
        l.leader ? `, leader ${l.leader}` : ""
      }`;
    } else if (delta > 0.05) {
      const sr = l.sectorReturnPct ?? 0;
      action = `Underweight by ${(delta * 100).toFixed(1)}pt — sector ${
        sr >= 0 ? "+" : ""
      }${sr.toFixed(1)}%`;
    } else if (delta < -0.05) {
      action = `Overweight by ${(Math.abs(delta) * 100).toFixed(1)}pt — consider trim`;
    } else if (l.currentWeight > 0) {
      action = "On target";
    }
    return {
      sector: l.sector,
      currentWeight: l.currentWeight,
      currentValue: l.currentValue,
      optimalWeight,
      deltaWeight: delta,
      sectorReturnPct: l.sectorReturnPct,
      leader: l.leader,
      symbols: l.symbols,
      action,
    };
  });

  return {
    lanes: out,
    otherWeight: totalValue > 0 ? otherValue / totalValue : 0,
    otherValue,
    otherSymbols,
    totalValue,
  };
}
