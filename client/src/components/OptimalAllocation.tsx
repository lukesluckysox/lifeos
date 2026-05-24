import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLookback } from "@/components/LookbackContext";

/* ---------- Types ---------- */

interface SentimentResult {
  symbol: string;
  currentPrice: number | null;
  returnPct: number | null;
  sentiment: number;
  label: string;
}

interface Holding {
  symbol: string;
  value: number; // current dollar value
  name?: string;
}

interface Props {
  holdings: Holding[];
}

interface SectorSlice {
  sector: string;
  weight: number; // 0..1
  value: number;
  returnPct: number | null; // value-weighted avg return of constituents
  color: string;
  symbols: string[]; // constituents for tooltip / debug
}

interface SectorLookupResp {
  sectors: Record<string, string>;
}

/* ---------- Sector palette (deterministic) ---------- */

const SECTOR_COLORS: Record<string, string> = {
  Tech:           "#5eead4", // teal-300
  Finance:        "#a78bfa", // violet-400
  Healthcare:     "#fb7185", // rose-400
  Consumer:       "#f59e0b", // amber-500
  Energy:         "#fb923c", // orange-400
  Crypto:         "#facc15", // yellow-400
  Industrials:    "#60a5fa", // blue-400
  Utilities:      "#34d399", // emerald-400
  Materials:      "#f472b6", // pink-400
  "Real Estate":  "#22d3ee", // cyan-400
  Communications: "#c084fc", // purple-400
  "Broad Market": "#94a3b8", // slate-400
  International:  "#38bdf8", // sky-400
  Bonds:          "#a3e635", // lime-400
  Commodities:    "#fcd34d", // yellow-300
  Other:          "#64748b", // slate-500
};

const FALLBACK_PALETTE = ["#5eead4", "#a78bfa", "#f59e0b", "#fb7185", "#60a5fa", "#34d399", "#facc15", "#f472b6", "#22d3ee", "#fb923c", "#c084fc", "#94a3b8"];

function colorFor(sector: string, idx: number): string {
  return SECTOR_COLORS[sector] ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

/* ---------- Donut renderer ---------- */

function Donut({ slices, label, sublabel, size = 180 }: {
  slices: SectorSlice[];
  label: string;
  sublabel: string;
  size?: number;
}) {
  const radius = size / 2;
  const stroke = 22;
  const inner = radius - stroke;
  const C = 2 * Math.PI * inner;

  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={radius}
            cy={radius}
            r={inner}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={stroke}
            opacity={0.35}
          />
          {slices.map((s, i) => {
            const w = Number.isFinite(s.weight) ? s.weight : 0;
            const len = C * w;
            const dasharray = `${len} ${C - len}`;
            const offset = -acc;
            acc += len;
            return (
              <circle
                key={s.sector + i}
                cx={radius}
                cy={radius}
                r={inner}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={dasharray}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-display text-xl tabular text-foreground leading-none">{label}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{sublabel}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */

export function OptimalAllocation({ holdings }: Props) {
  const { weeks, label: weeksLabel } = useLookback();
  const [investAmount, setInvestAmount] = useState<string>("1000");

  // Aggregate holdings by symbol (sum values)
  const aggregated = useMemo(() => {
    const map = new Map<string, { symbol: string; value: number }>();
    for (const h of holdings) {
      const sym = h.symbol?.toUpperCase();
      if (!sym) continue;
      const prev = map.get(sym);
      if (prev) prev.value += h.value;
      else map.set(sym, { symbol: sym, value: h.value });
    }
    return Array.from(map.values()).filter((x) => x.value > 0);
  }, [holdings]);

  const symbols = aggregated.map((h) => h.symbol);
  const totalValue = aggregated.reduce((s, h) => s + h.value, 0);

  /* Sector lookup (cached by sorted symbol set) */
  const sectorQuery = useQuery<SectorLookupResp>({
    queryKey: ["/api/sector-lookup", symbols.sort().join(",")],
    queryFn: async () => {
      if (!symbols.length) return { sectors: {} };
      const res = await apiRequest("POST", "/api/sector-lookup", { symbols });
      return res.json();
    },
    enabled: symbols.length > 0,
    staleTime: 60 * 60 * 1000, // 1h — sectors don't change
  });

  const sectorMap = sectorQuery.data?.sectors ?? {};

  /* Sentiment (returns) per symbol for the active lookback */
  const sentimentQuery = useQuery<SentimentResult[]>({
    queryKey: ["/api/sentiment/batch", symbols.sort().join(","), weeks],
    queryFn: async () => {
      if (!symbols.length) return [];
      const res = await apiRequest("POST", "/api/sentiment/batch", { symbols, weeks });
      return res.json();
    },
    enabled: symbols.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const sentMap = useMemo(() => {
    const m = new Map<string, SentimentResult>();
    for (const r of sentimentQuery.data ?? []) m.set(r.symbol.toUpperCase(), r);
    return m;
  }, [sentimentQuery.data]);

  /* Bucket by sector, computing value-weighted return per sector */
  const sectorBuckets = useMemo(() => {
    type Bucket = { sector: string; value: number; weightedReturnNum: number; weightedReturnDen: number; symbols: string[] };
    const map = new Map<string, Bucket>();
    for (const h of aggregated) {
      const sector = sectorMap[h.symbol] ?? "Other";
      const r = sentMap.get(h.symbol)?.returnPct;
      const prev = map.get(sector) ?? { sector, value: 0, weightedReturnNum: 0, weightedReturnDen: 0, symbols: [] };
      prev.value += h.value;
      if (r != null && Number.isFinite(r)) {
        prev.weightedReturnNum += r * h.value;
        prev.weightedReturnDen += h.value;
      }
      prev.symbols.push(h.symbol);
      map.set(sector, prev);
    }
    return Array.from(map.values()).map((b) => ({
      sector: b.sector,
      value: b.value,
      returnPct: b.weightedReturnDen > 0 ? b.weightedReturnNum / b.weightedReturnDen : null,
      symbols: b.symbols,
    }));
  }, [aggregated, sectorMap, sentMap]);

  /* Current allocation by sector (weight = sector $ / total $) */
  const currentSlices: SectorSlice[] = useMemo(() => {
    return sectorBuckets
      .map((b, i) => ({
        sector: b.sector,
        weight: totalValue > 0 ? b.value / totalValue : 0,
        value: b.value,
        returnPct: b.returnPct,
        color: colorFor(b.sector, i),
        symbols: b.symbols,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [sectorBuckets, totalValue]);

  /* Performance-weighted optimal allocation by sector
     - score = max(returnPct, 0) + 1  (flat = 1, +30% = 31, -10% = 1)
     - Losing sectors keep a baseline so the book stays diversified */
  const optimalSlices: SectorSlice[] = useMemo(() => {
    if (!sectorBuckets.length) return [];
    const scored = sectorBuckets.map((b, i) => {
      const r = b.returnPct ?? 0;
      const score = Math.max(r, 0) + 1;
      return { ...b, score, idx: i };
    });
    const totalScore = scored.reduce((s, x) => s + x.score, 0);
    if (totalScore <= 0) return [];
    return scored
      .map((s) => ({
        sector: s.sector,
        weight: s.score / totalScore,
        value: 0, // optimal donut is conceptual
        returnPct: s.returnPct,
        color: colorFor(s.sector, s.idx),
        symbols: s.symbols,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [sectorBuckets]);

  /* What-if simulator: deploy $X using optimal SECTOR weights,
     project return at the active lookback using each sector's value-weighted return. */
  const investNum = Math.max(0, parseFloat(investAmount) || 0);
  const projection = useMemo(() => {
    if (investNum <= 0 || !optimalSlices.length) return { dollars: 0, pct: 0 };
    let weighted = 0;
    for (const s of optimalSlices) {
      const r = (s.returnPct ?? 0) / 100;
      weighted += s.weight * r;
    }
    return { dollars: investNum * weighted, pct: weighted * 100 };
  }, [investNum, optimalSlices]);

  /* ---------- Render states ---------- */

  if (!holdings.length) {
    return null;
  }

  const isLoadingSectors = sectorQuery.isLoading && !sectorQuery.data;
  const isLoadingSentiment = sentimentQuery.isLoading && !sentimentQuery.data;

  return (
    <section className="space-y-6" data-testid="card-optimal-allocation">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow mb-1">Optimal allocation · by sector</div>
          <h2 className="font-display text-xl text-foreground">If you let the winning sectors lead</h2>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-md leading-relaxed">
            Performance-weighted across the active <span className="font-mono text-foreground">{weeksLabel}</span> window. Sectors that lagged keep a baseline so the book stays diversified.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        {(isLoadingSectors || isLoadingSentiment) && !currentSlices.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground font-mono">Loading allocation…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[auto_auto_1fr] gap-8 items-start">
            {/* Current donut */}
            <Donut
              slices={currentSlices}
              label="Now"
              sublabel="By value"
              size={180}
            />

            {/* Optimal donut */}
            <Donut
              slices={optimalSlices.length ? optimalSlices : currentSlices}
              label="Optimal"
              sublabel={weeksLabel + " perf"}
              size={180}
            />

            {/* Legend + simulator */}
            <div className="space-y-5 min-w-0">
              <div>
                <div className="eyebrow mb-2.5">Sector weights</div>
                <div className="grid grid-cols-1 gap-y-1.5 text-xs">
                  {optimalSlices.slice(0, 10).map((s) => {
                    const cur = currentSlices.find((c) => c.sector === s.sector);
                    const delta = s.weight - (cur?.weight ?? 0);
                    return (
                      <div
                        key={s.sector}
                        className="flex items-center gap-2 min-w-0"
                        data-testid={`row-optimal-${s.sector.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: s.color }}
                        />
                        <span className="font-mono text-foreground truncate" title={s.symbols.join(", ")}>
                          {s.sector}
                        </span>
                        <span className="font-mono tabular text-muted-foreground/70 text-[10px] flex-shrink-0">
                          {s.symbols.length} hldg{s.symbols.length !== 1 ? "s" : ""}
                        </span>
                        <span className="font-mono tabular text-muted-foreground ml-auto">
                          {(s.weight * 100).toFixed(1)}%
                        </span>
                        <span
                          className={`font-mono tabular text-[10px] w-12 text-right ${delta >= 0 ? "text-teal" : "text-rose"}`}
                        >
                          {`${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-border/60">
                <div className="eyebrow mb-2.5">What-if simulator</div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm text-muted-foreground">$</span>
                    <input
                      type="number"
                      step="100"
                      min="0"
                      value={investAmount}
                      onChange={(e) => setInvestAmount(e.target.value)}
                      data-testid="input-whatif-amount"
                      className="w-24 h-8 px-2 rounded-md border border-border bg-background text-sm font-mono tabular"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">at optimal sector mix would have returned →</span>
                  <div className="flex items-baseline gap-2">
                    <span
                      data-testid="text-whatif-result"
                      className={`font-display text-lg tabular ${projection.dollars >= 0 ? "text-teal" : "text-rose"}`}
                    >
                      {projection.dollars >= 0 ? "+" : "-"}${Math.abs(projection.dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <span className={`font-mono text-xs tabular ${projection.pct >= 0 ? "text-teal" : "text-rose"}`}>
                      ({projection.pct >= 0 ? "+" : ""}{projection.pct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
                <p className="text-[10.5px] text-muted-foreground/80 mt-2 leading-relaxed">
                  Sector returns are value-weighted across your holdings in that sector over the last {weeksLabel}. Past performance, not a forecast.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
