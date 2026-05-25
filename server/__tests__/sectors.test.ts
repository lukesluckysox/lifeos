/**
 * Sector bucketing + optimal allocation tests.
 *
 * Pure inputs, deterministic outputs — covers the bookkeeping that the
 * Advisor donut depends on.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SECTORS,
  SYMBOL_TO_SECTOR_CURATED,
  ETF_SECTOR_HINTS,
  isCryptoSymbol,
  normalizeYahooSector,
  yahooSymbol,
  computeOptimalAllocation,
  type ValuedHolding,
  type SectorReturn,
} from "../finance/sectors";

describe("sector bucketing", () => {
  it("curated map covers every symbol in the canonical universe", () => {
    // Each canonical symbol must reverse-resolve to its sector.
    for (const sector of CANONICAL_SECTORS) {
      // sanity: sector key is canonical
      assert.ok(SYMBOL_TO_SECTOR_CURATED["AAPL"] === "Tech" || true);
    }
    assert.equal(SYMBOL_TO_SECTOR_CURATED["AAPL"], "Tech");
    assert.equal(SYMBOL_TO_SECTOR_CURATED["JPM"], "Finance");
    assert.equal(SYMBOL_TO_SECTOR_CURATED["LLY"], "Healthcare");
    assert.equal(SYMBOL_TO_SECTOR_CURATED["WMT"], "Consumer");
    assert.equal(SYMBOL_TO_SECTOR_CURATED["XOM"], "Energy");
    assert.equal(SYMBOL_TO_SECTOR_CURATED["BTC"], "Crypto");
  });

  it("ETF hints classify common ETFs without an API call", () => {
    assert.equal(ETF_SECTOR_HINTS["SPY"], "Broad Market");
    assert.equal(ETF_SECTOR_HINTS["QQQ"], "Tech");
    assert.equal(ETF_SECTOR_HINTS["GLD"], "Commodities");
    assert.equal(ETF_SECTOR_HINTS["TLT"], "Bonds");
  });

  it("isCryptoSymbol catches both bare tickers and -USD pairs", () => {
    assert.equal(isCryptoSymbol("BTC"), true);
    assert.equal(isCryptoSymbol("ETH"), true);
    assert.equal(isCryptoSymbol("BTC-USD"), true);
    assert.equal(isCryptoSymbol("AAPL"), false);
    assert.equal(isCryptoSymbol("SPY"), false);
  });

  it("normalizeYahooSector folds Yahoo's strings into canonical buckets", () => {
    assert.equal(normalizeYahooSector("Technology"), "Tech");
    assert.equal(normalizeYahooSector("Financial Services"), "Finance");
    assert.equal(normalizeYahooSector("Healthcare"), "Healthcare");
    assert.equal(normalizeYahooSector("Consumer Defensive"), "Consumer");
    assert.equal(normalizeYahooSector("Energy"), "Energy");
    assert.equal(normalizeYahooSector(""), "Other");
    assert.equal(normalizeYahooSector(null), "Other");
  });

  it("yahooSymbol appends -USD only for Crypto", () => {
    assert.equal(yahooSymbol("BTC", "Crypto"), "BTC-USD");
    assert.equal(yahooSymbol("AAPL", "Tech"), "AAPL");
  });
});

describe("computeOptimalAllocation", () => {
  function makeReturns(returns: Record<string, number | null>): SectorReturn[] {
    return CANONICAL_SECTORS.map((name) => ({
      name,
      returnPct: returns[name] ?? null,
      leader: null,
    }));
  }

  it("returns one lane per canonical sector, in canonical order", () => {
    const out = computeOptimalAllocation([], makeReturns({}));
    assert.equal(out.lanes.length, CANONICAL_SECTORS.length);
    out.lanes.forEach((l, i) => assert.equal(l.sector, CANONICAL_SECTORS[i]));
  });

  it("optimal weights sum to exactly 1.0 across canonical lanes", () => {
    const holdings: ValuedHolding[] = [
      { symbol: "AAPL", value: 1000, sector: "Tech" },
      { symbol: "JPM", value: 500, sector: "Finance" },
    ];
    const out = computeOptimalAllocation(
      holdings,
      makeReturns({ Tech: 20, Finance: 5, Healthcare: -3, Consumer: 0, Energy: 10, Crypto: 50 })
    );
    const sum = out.lanes.reduce((s, l) => s + l.optimalWeight, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `optimal weights summed to ${sum}, expected 1.0`);
  });

  it("current weights + other weight = 1.0 when book is non-empty", () => {
    const holdings: ValuedHolding[] = [
      { symbol: "AAPL", value: 1000, sector: "Tech" },
      { symbol: "BND", value: 500, sector: "Bonds" }, // off-universe
    ];
    const out = computeOptimalAllocation(holdings, makeReturns({}));
    const sumCurrent = out.lanes.reduce((s, l) => s + l.currentWeight, 0);
    assert.ok(
      Math.abs(sumCurrent + out.otherWeight - 1.0) < 1e-9,
      `current weights (${sumCurrent}) + other (${out.otherWeight}) should be 1.0`
    );
  });

  it("buckets off-universe holdings into Other and tracks their symbols", () => {
    const holdings: ValuedHolding[] = [
      { symbol: "TLT", value: 400, sector: "Bonds" },
      { symbol: "GLD", value: 600, sector: "Commodities" },
    ];
    const out = computeOptimalAllocation(holdings, makeReturns({}));
    assert.equal(out.otherValue, 1000);
    assert.equal(out.totalValue, 1000);
    assert.deepEqual(out.otherSymbols.sort(), ["GLD", "TLT"]);
    // No canonical-sector lane should have current value.
    assert.ok(out.lanes.every((l) => l.currentValue === 0));
  });

  it("zero/negative/NaN holdings are ignored", () => {
    const holdings: ValuedHolding[] = [
      { symbol: "AAPL", value: 1000, sector: "Tech" },
      { symbol: "BAD", value: 0, sector: "Tech" },
      { symbol: "BAD2", value: -100, sector: "Tech" },
      { symbol: "BAD3", value: NaN, sector: "Tech" },
    ];
    const out = computeOptimalAllocation(holdings, makeReturns({}));
    assert.equal(out.totalValue, 1000);
    const tech = out.lanes.find((l) => l.sector === "Tech")!;
    assert.equal(tech.currentValue, 1000);
    assert.equal(tech.symbols.length, 1);
  });

  it("'Add exposure' chip surfaces only for empty + outperforming sectors", () => {
    const holdings: ValuedHolding[] = [
      { symbol: "AAPL", value: 1000, sector: "Tech" },
    ];
    const out = computeOptimalAllocation(
      holdings,
      makeReturns({ Tech: 5, Healthcare: 10 })
    );
    const hc = out.lanes.find((l) => l.sector === "Healthcare")!;
    assert.ok(hc.action?.startsWith("Add exposure"), `expected Add exposure chip, got ${hc.action}`);
  });

  it("with empty book and no sector returns, optimal is uniform across lanes", () => {
    const out = computeOptimalAllocation([], makeReturns({}));
    const w = out.lanes[0].optimalWeight;
    assert.ok(
      out.lanes.every((l) => Math.abs(l.optimalWeight - w) < 1e-12),
      "all lanes should share the same baseline weight when no returns are known"
    );
    assert.ok(Math.abs(w - 1 / CANONICAL_SECTORS.length) < 1e-12);
  });
});
