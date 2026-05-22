import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLookback } from "@/components/LookbackContext";

/* ---------- Types ---------- */

interface ChartHistory {
  symbol: string;
  currentPrice: number | null;
  returnPct: number | null;
  ytdReturnPct: number | null;
  closes: number[];
  weeks: number;
}

interface Props {
  symbols?: string[];
}

/* ---------- Default tile universe (ETFs + crypto) ---------- */

const DEFAULT_SYMBOLS = [
  "SPY", "QQQ", "VTI", "DIA", "IWM",          // broad US
  "VXUS", "EFA", "EEM",                        // intl + EM
  "BND", "TLT", "GLD",                         // bonds + gold
  "BTC-USD", "ETH-USD", "SOL-USD",             // crypto
];

const DISPLAY: Record<string, string> = {
  "BTC-USD": "BTC",
  "ETH-USD": "ETH",
  "SOL-USD": "SOL",
};

function display(sym: string): string {
  return DISPLAY[sym] ?? sym;
}

/* ---------- Sparkline ---------- */

function Sparkline({ closes, height = 32, width = 110, stroke = "currentColor" }: {
  closes: number[];
  height?: number;
  width?: number;
  stroke?: string;
}) {
  if (closes.length < 2) {
    return <div className="text-[10px] text-muted-foreground">—</div>;
  }
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const stepX = width / (closes.length - 1);
  const path = closes
    .map((c, i) => {
      const x = i * stepX;
      const y = height - ((c - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  // soft area fill underneath
  const area = path + ` L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={area} fill={stroke} opacity={0.12} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- Tile ---------- */

function Tile({
  symbol,
  data,
  loading,
  expanded,
  onToggle,
}: {
  symbol: string;
  data: ChartHistory | undefined;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ret = data?.returnPct;
  const positive = (ret ?? 0) >= 0;
  const colorClass = ret == null ? "text-muted-foreground" : positive ? "text-teal" : "text-rose";

  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={`tile-etf-${display(symbol).toLowerCase()}`}
      aria-expanded={expanded}
      className={[
        "text-left rounded-lg border bg-card p-3.5 transition-all duration-200",
        expanded
          ? "border-teal/50 shadow-[0_0_0_1px_rgba(94,234,212,0.15)] col-span-2 row-span-2"
          : "border-border hover:border-foreground/30 hover:bg-card/80",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[11px] font-semibold text-foreground tracking-wide">{display(symbol)}</div>
        <div className={`font-mono text-[11px] tabular ${colorClass}`}>
          {ret == null ? "—" : `${positive ? "+" : ""}${ret.toFixed(2)}%`}
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="font-mono tabular text-foreground text-sm">
          {loading ? (
            <span className="inline-block h-3 w-12 bg-muted-foreground/20 rounded animate-pulse" />
          ) : data?.currentPrice != null ? (
            `$${data.currentPrice.toLocaleString(undefined, { maximumFractionDigits: data.currentPrice < 10 ? 4 : 2 })}`
          ) : (
            "—"
          )}
        </div>
        <div className={colorClass}>
          {loading ? (
            <div className="h-8 w-[110px] bg-muted-foreground/10 rounded animate-pulse" />
          ) : (
            <Sparkline closes={data?.closes ?? []} stroke="currentColor" />
          )}
        </div>
      </div>

      {expanded && data && (
        <div className="mt-4 pt-4 border-t border-border/60 space-y-3">
          <div className={colorClass}>
            <Sparkline closes={data.closes} height={70} width={260} stroke="currentColor" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <ExpandedStat label="Lookback" value={data.returnPct} />
            <ExpandedStat label="YTD" value={data.ytdReturnPct} />
            <ExpandedStat label="Price" rawText={data.currentPrice != null ? `$${data.currentPrice.toLocaleString(undefined, { maximumFractionDigits: data.currentPrice < 10 ? 4 : 2 })}` : "—"} />
          </div>
        </div>
      )}
    </button>
  );
}

function ExpandedStat({ label, value, rawText }: { label: string; value?: number | null; rawText?: string }) {
  let display = "—";
  let cls = "text-muted-foreground";
  if (rawText !== undefined) {
    display = rawText;
    cls = "text-foreground";
  } else if (value != null) {
    display = `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
    cls = value >= 0 ? "text-teal" : "text-rose";
  }
  return (
    <div>
      <div className="eyebrow text-[9px] mb-1">{label}</div>
      <div className={`font-mono tabular text-sm ${cls}`}>{display}</div>
    </div>
  );
}

/* ---------- Main ---------- */

export function ETFTiles({ symbols = DEFAULT_SYMBOLS }: Props) {
  const { weeks, label: weeksLabel } = useLookback();
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery<ChartHistory[]>({
    queryKey: ["/api/chart-history/batch", symbols.sort().join(","), weeks],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/chart-history/batch", { symbols, weeks });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const dataMap = new Map<string, ChartHistory>();
  for (const r of query.data ?? []) dataMap.set(r.symbol.toUpperCase(), r);

  return (
    <section data-testid="card-etf-tiles">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="eyebrow mb-1">Pulse</div>
          <h2 className="font-display text-xl text-foreground">Index & ETF tiles</h2>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-md leading-relaxed">
            Tap any tile to expand its <span className="font-mono text-foreground">{weeksLabel}</span> chart in place. Returns reflect the active lookback.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 auto-rows-[auto]">
        {symbols.map((sym) => (
          <Tile
            key={sym}
            symbol={sym}
            data={dataMap.get(sym.toUpperCase())}
            loading={query.isLoading}
            expanded={expanded === sym}
            onToggle={() => setExpanded(expanded === sym ? null : sym)}
          />
        ))}
      </div>
    </section>
  );
}
