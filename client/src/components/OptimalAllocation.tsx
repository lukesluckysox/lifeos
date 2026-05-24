import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLookback } from "@/components/LookbackContext";

/* ---------- Types ---------- */

interface Holding {
  symbol: string;
  value: number;
  name?: string;
}

interface Props {
  holdings: Holding[];
}

interface Lane {
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

interface OptimalResp {
  lanes: Lane[];
  otherWeight: number;
  otherValue: number;
  otherSymbols: string[];
  totalValue: number;
  weeks: number;
}

interface SectorSlice {
  sector: string;
  weight: number;
  color: string;
  returnPct: number | null;
}

/* ---------- Sector palette — must match CategoryLeaders accent colors ---------- */

const SECTOR_COLORS: Record<string, string> = {
  Tech:       "#5eead4", // teal-300
  Finance:    "#f59e0b", // amber-500
  Healthcare: "#fb7185", // rose-400
  Consumer:   "#a78bfa", // violet-400
  Energy:     "#fb923c", // orange-400
  Crypto:     "#60a5fa", // blue-400
  Other:      "#64748b", // slate-500
};

function colorFor(sector: string): string {
  return SECTOR_COLORS[sector] ?? "#64748b";
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

  // Aggregate by symbol (sum values), pass to server
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

  const optimalQuery = useQuery<OptimalResp>({
    queryKey: [
      "/api/optimal-allocation",
      aggregated.map((h) => `${h.symbol}:${h.value.toFixed(0)}`).sort().join(","),
      weeks,
    ],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/optimal-allocation", {
        holdings: aggregated,
        weeks,
      });
      return res.json();
    },
    enabled: aggregated.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const lanes = optimalQuery.data?.lanes ?? [];
  const otherWeight = optimalQuery.data?.otherWeight ?? 0;

  /* Donut slices — same canonical order both donuts */
  const currentSlices: SectorSlice[] = useMemo(() => {
    const slices: SectorSlice[] = lanes
      .filter((l) => l.currentWeight > 0)
      .map((l) => ({
        sector: l.sector,
        weight: l.currentWeight,
        color: colorFor(l.sector),
        returnPct: l.sectorReturnPct,
      }));
    if (otherWeight > 0) {
      slices.push({ sector: "Other", weight: otherWeight, color: colorFor("Other"), returnPct: null });
    }
    return slices.sort((a, b) => b.weight - a.weight);
  }, [lanes, otherWeight]);

  const optimalSlices: SectorSlice[] = useMemo(() => {
    if (!lanes.length) return [];
    return lanes
      .map((l) => ({
        sector: l.sector,
        weight: l.optimalWeight,
        color: colorFor(l.sector),
        returnPct: l.sectorReturnPct,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [lanes]);

  /* What-if simulator */
  const investNum = Math.max(0, parseFloat(investAmount) || 0);
  const projection = useMemo(() => {
    if (investNum <= 0 || !lanes.length) return { dollars: 0, pct: 0 };
    let weighted = 0;
    for (const l of lanes) {
      const r = (l.sectorReturnPct ?? 0) / 100;
      weighted += l.optimalWeight * r;
    }
    return { dollars: investNum * weighted, pct: weighted * 100 };
  }, [investNum, lanes]);

  if (!holdings.length) return null;

  const isLoading = optimalQuery.isLoading && !optimalQuery.data;

  return (
    <section className="space-y-6" data-testid="card-optimal-allocation">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow mb-1">Optimal allocation · canonical sectors</div>
          <h2 className="font-display text-xl text-foreground">If you let the winning lanes lead</h2>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-md leading-relaxed">
            Mapped to the same six lanes as the category leaders below. Performance-weighted across the active{" "}
            <span className="font-mono text-foreground">{weeksLabel}</span> window — lagging lanes keep a baseline so the book stays diversified.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground font-mono">Loading allocation…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[auto_auto_1fr] gap-8 items-start">
            <Donut slices={currentSlices.length ? currentSlices : [{ sector: "Other", weight: 1, color: colorFor("Other"), returnPct: null }]} label="Now" sublabel="By value" size={180} />
            <Donut slices={optimalSlices.length ? optimalSlices : currentSlices} label="Optimal" sublabel={weeksLabel + " perf"} size={180} />

            <div className="space-y-5 min-w-0">
              <div>
                <div className="eyebrow mb-2.5">Lane weights · current vs optimal</div>
                <div className="grid grid-cols-1 gap-y-1.5 text-xs">
                  {lanes.map((l) => {
                    const delta = l.deltaWeight;
                    return (
                      <div
                        key={l.sector}
                        className="flex items-center gap-2 min-w-0"
                        data-testid={`row-optimal-${l.sector.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: colorFor(l.sector) }}
                        />
                        <span className="font-mono text-foreground truncate" title={l.symbols.join(", ") || "no holdings"}>
                          {l.sector}
                        </span>
                        <span className="font-mono tabular text-muted-foreground/70 text-[10px] flex-shrink-0">
                          {l.symbols.length} hldg{l.symbols.length !== 1 ? "s" : ""}
                        </span>
                        <span className="font-mono tabular text-muted-foreground ml-auto">
                          {(l.currentWeight * 100).toFixed(1)}% → {(l.optimalWeight * 100).toFixed(1)}%
                        </span>
                        <span
                          className={`font-mono tabular text-[10px] w-12 text-right ${delta >= 0 ? "text-teal" : "text-rose"}`}
                        >
                          {`${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}`}
                        </span>
                      </div>
                    );
                  })}
                  {otherWeight > 0 && (
                    <div className="flex items-center gap-2 min-w-0 opacity-70" data-testid="row-optimal-other">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorFor("Other") }} />
                      <span className="font-mono text-foreground truncate">Other / off-universe</span>
                      <span className="font-mono tabular text-muted-foreground ml-auto">
                        {(otherWeight * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action chips per lane */}
              {lanes.some((l) => l.action) && (
                <div>
                  <div className="eyebrow mb-2.5">What a third party would flag</div>
                  <div className="flex flex-col gap-1.5">
                    {lanes
                      .filter((l) => l.action && l.action !== "On target")
                      .slice(0, 4)
                      .map((l) => {
                        const positive = l.action?.startsWith("Add") || l.action?.startsWith("Underweight");
                        return (
                          <div
                            key={l.sector}
                            data-testid={`action-${l.sector.toLowerCase()}`}
                            className="flex items-start gap-2 text-[11px] leading-snug"
                          >
                            <span
                              className="font-mono text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5"
                              style={{ borderColor: colorFor(l.sector), color: colorFor(l.sector) }}
                            >
                              {l.sector}
                            </span>
                            <span className={positive ? "text-teal" : "text-rose"}>{l.action}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

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
                  <span className="text-xs text-muted-foreground">at optimal lane mix would have returned →</span>
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
                  Lane returns are average top-5 constituent returns over the last {weeksLabel}. Past performance, not a forecast.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
