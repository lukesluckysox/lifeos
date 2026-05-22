import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLookback } from "@/components/LookbackContext";

/* ---------- Types ---------- */

interface SectorRow {
  symbol: string;
  displaySymbol: string;
  returnPct: number | null;
  sentiment: number;
  currentPrice: number | null;
}

interface Sector {
  name: string;
  leader: SectorRow | null;
  top10: SectorRow[];
}

interface SectorLeadersResponse {
  sectors: Sector[];
  weeks: number;
}

/* ---------- Sector visual identity ---------- */

const SECTOR_STYLE: Record<string, { accent: string; bg: string; border: string; icon: React.ReactNode }> = {
  Tech: {
    accent: "text-teal",
    bg: "from-teal/8 to-transparent",
    border: "border-teal/25",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <rect x="3" y="3" width="18" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  Finance: {
    accent: "text-amber-400",
    bg: "from-amber-500/8 to-transparent",
    border: "border-amber-500/25",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21V14h6v7" />
      </svg>
    ),
  },
  Healthcare: {
    accent: "text-rose-400",
    bg: "from-rose-500/8 to-transparent",
    border: "border-rose-500/25",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M12 2v20M2 12h20" />
      </svg>
    ),
  },
  Consumer: {
    accent: "text-violet-400",
    bg: "from-violet-500/8 to-transparent",
    border: "border-violet-500/25",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
      </svg>
    ),
  },
  Energy: {
    accent: "text-orange-400",
    bg: "from-orange-500/8 to-transparent",
    border: "border-orange-500/25",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  Crypto: {
    accent: "text-blue-400",
    bg: "from-blue-500/8 to-transparent",
    border: "border-blue-500/25",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 8h5a2 2 0 0 1 0 4H9zm0 4h6a2 2 0 0 1 0 4H9zm2-8v2m0 12v2" />
      </svg>
    ),
  },
};

const FALLBACK_STYLE = SECTOR_STYLE.Tech;

/* ---------- Trophy card ---------- */

function TrophyCard({ sector, expanded, onToggle }: { sector: Sector; expanded: boolean; onToggle: () => void }) {
  const style = SECTOR_STYLE[sector.name] ?? FALLBACK_STYLE;
  const leader = sector.leader;
  const ret = leader?.returnPct;
  const positive = (ret ?? 0) >= 0;

  return (
    <div
      data-testid={`card-sector-${sector.name.toLowerCase()}`}
      className={[
        "rounded-lg border bg-gradient-to-br",
        style.bg,
        style.border,
        "p-4 transition-all duration-200",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className={style.accent}>{style.icon}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {sector.name}
          </span>
        </div>
        {/* Trophy icon */}
        <span className={style.accent}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
            <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 7H4v2a3 3 0 0 0 3 3M17 7h3v2a3 3 0 0 1-3 3" />
          </svg>
        </span>
      </div>

      {leader ? (
        <>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <div className="font-display text-lg text-foreground tabular" data-testid={`text-leader-${sector.name.toLowerCase()}`}>
              {leader.displaySymbol}
            </div>
            <div className={`font-mono tabular text-sm ${positive ? "text-teal" : "text-rose"}`}>
              {ret != null ? `${positive ? "+" : ""}${ret.toFixed(2)}%` : "—"}
            </div>
          </div>
          {leader.currentPrice != null && (
            <div className="font-mono text-[10px] text-muted-foreground tabular">
              @ ${leader.currentPrice.toLocaleString(undefined, { maximumFractionDigits: leader.currentPrice < 10 ? 4 : 2 })}
            </div>
          )}
        </>
      ) : (
        <div className="font-mono text-xs text-muted-foreground">No data</div>
      )}

      <button
        type="button"
        onClick={onToggle}
        data-testid={`button-top10-${sector.name.toLowerCase()}`}
        className="mt-3 w-full text-left text-[11px] font-mono text-muted-foreground hover:text-foreground border-t border-border/40 pt-2 flex items-center justify-between transition-colors"
      >
        <span>{expanded ? "Hide" : "Top 10"}</span>
        <span className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1" data-testid={`list-top10-${sector.name.toLowerCase()}`}>
          {sector.top10.map((row, i) => {
            const r = row.returnPct;
            const pos = (r ?? 0) >= 0;
            return (
              <div
                key={row.symbol}
                className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-border/30 last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono tabular text-muted-foreground/60 w-4 text-right">{i + 1}</span>
                  <span className="font-mono text-foreground">{row.displaySymbol}</span>
                </div>
                <span className={`font-mono tabular ${pos ? "text-teal" : "text-rose"}`}>
                  {r != null ? `${pos ? "+" : ""}${r.toFixed(2)}%` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Skeleton ---------- */

function TrophySkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex justify-between">
        <div className="h-3 w-12 bg-muted-foreground/20 rounded animate-pulse" />
        <div className="h-3 w-3 bg-muted-foreground/20 rounded animate-pulse" />
      </div>
      <div className="h-5 w-16 bg-muted-foreground/20 rounded animate-pulse" />
      <div className="h-3 w-20 bg-muted-foreground/15 rounded animate-pulse" />
      <div className="h-7 w-full bg-muted-foreground/10 rounded animate-pulse" />
    </div>
  );
}

/* ---------- Main ---------- */

export function CategoryLeaders() {
  const { weeks, label: weeksLabel } = useLookback();
  const [expandedSector, setExpandedSector] = useState<string | null>(null);

  const query = useQuery<SectorLeadersResponse>({
    queryKey: ["/api/sector-leaders", weeks],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/sector-leaders", { weeks });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const sectors = query.data?.sectors ?? [];

  return (
    <section data-testid="card-category-leaders">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="eyebrow mb-1">Category leaders</div>
          <h2 className="font-display text-xl text-foreground">Who's winning each lane</h2>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-md leading-relaxed">
            Best performer in each sector across the active <span className="font-mono text-foreground">{weeksLabel}</span> window. Tap a card to see its Top 10.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {query.isLoading
          ? Array.from({ length: 6 }).map((_, i) => <TrophySkeleton key={i} />)
          : sectors.map((s) => (
              <TrophyCard
                key={s.name}
                sector={s}
                expanded={expandedSector === s.name}
                onToggle={() => setExpandedSector(expandedSector === s.name ? null : s.name)}
              />
            ))}
      </div>
    </section>
  );
}
