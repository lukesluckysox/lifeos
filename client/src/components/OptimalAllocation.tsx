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

interface SliceData {
  symbol: string;
  weight: number; // 0..1
  value: number;
  returnPct: number | null;
  color: string;
}

/* ---------- Color palette (deterministic per symbol) ---------- */

const PALETTE = [
  "#5eead4", // teal-300
  "#a78bfa", // violet-400
  "#f59e0b", // amber-500
  "#fb7185", // rose-400
  "#60a5fa", // blue-400
  "#34d399", // emerald-400
  "#facc15", // yellow-400
  "#f472b6", // pink-400
  "#22d3ee", // cyan-400
  "#fb923c", // orange-400
];

function colorFor(symbol: string, idx: number): string {
  return PALETTE[idx % PALETTE.length];
}

/* ---------- Donut renderer ---------- */

function Donut({ slices, label, sublabel, size = 180 }: {
  slices: SliceData[];
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
            const len = C * s.weight;
            const dasharray = `${len} ${C - len}`;
            const offset = -acc;
            acc += len;
            return (
              <circle
                key={s.symbol + i}
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

  // Aggregate holdings by symbol
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

  /* Current allocation (weights from value) */
  const currentSlices: SliceData[] = useMemo(() => {
    return aggregated
      .map((h, i) => ({
        symbol: h.symbol,
        weight: totalValue > 0 ? h.value / totalValue : 0,
        value: h.value,
        returnPct: sentMap.get(h.symbol)?.returnPct ?? null,
        color: colorFor(h.symbol, i),
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [aggregated, totalValue, sentMap]);

  /* Performance-weighted optimal allocation
     - score = max(returnPct, 0) + 1  (so flat = 1, +30% = 31, -10% = 1)
     - Negative-return tickers still get baseline weight (1) so the donut never empties
     - This makes winners get more, losers get a floor */
  const optimalSlices: SliceData[] = useMemo(() => {
    const scored = aggregated.map((h, i) => {
      const r = sentMap.get(h.symbol)?.returnPct ?? 0;
      const score = Math.max(r, 0) + 1;
      return { ...h, score, idx: i, returnPct: sentMap.get(h.symbol)?.returnPct ?? null };
    });
    const totalScore = scored.reduce((s, x) => s + x.score, 0);
    if (totalScore <= 0) return [];
    return scored
      .map((s) => ({
        symbol: s.symbol,
        weight: s.score / totalScore,
        value: 0, // optimal donut is conceptual
        returnPct: s.returnPct,
        color: colorFor(s.symbol, s.idx),
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [aggregated, sentMap]);

  /* What-if simulator: deploy $X using optimal weights, project return at lookback */
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
    return null; // hide entirely when no holdings — Sentiment empty state already covers it
  }

  return (
    <section className="space-y-6" data-testid="card-optimal-allocation">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow mb-1">Optimal allocation</div>
          <h2 className="font-display text-xl text-foreground">If you let the winners lead</h2>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-md leading-relaxed">
            Performance-weighted across the active <span className="font-mono text-foreground">{weeksLabel}</span> window. Losers keep a baseline so the book stays diversified.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
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
              <div className="eyebrow mb-2.5">Top weights</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {optimalSlices.slice(0, 8).map((s) => {
                  const cur = currentSlices.find((c) => c.symbol === s.symbol);
                  const delta = s.weight - (cur?.weight ?? 0);
                  return (
                    <div
                      key={s.symbol}
                      className="flex items-center gap-2 min-w-0"
                      data-testid={`row-optimal-${s.symbol}`}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: s.color }}
                      />
                      <span className="font-mono text-foreground truncate">{s.symbol}</span>
                      <span className="font-mono tabular text-muted-foreground ml-auto">
                        {Number.isFinite(s.weight) ? (s.weight * 100).toFixed(1) : "0.0"}%
                      </span>
                      <span
                        className={`font-mono tabular text-[10px] w-12 text-right ${(Number.isFinite(delta) ? delta : 0) >= 0 ? "text-teal" : "text-rose"}`}
                      >
                        {Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}` : "0.0"}
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
                <span className="text-xs text-muted-foreground">deployed at optimal weights →</span>
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
                Based on each holding's actual {weeksLabel} return, weighted by the optimal mix above. Past performance, not a forecast.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
