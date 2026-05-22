import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLookback } from "@/components/LookbackContext";
import { LookbackPills } from "@/components/LookbackPills";

/* ---------- Types ---------- */

interface SentimentResult {
  symbol: string;
  currentPrice: number | null;
  returnPct: number | null;
  sentiment: number; // -1 to +1
  label: string;
}

interface Props {
  holdings: { symbol: string }[];
}

/* ---------- Helpers ---------- */

function sentimentToPercent(s: number): number {
  // Map -1..+1 → 0..100
  return ((s + 1) / 2) * 100;
}

function avgSentiment(items: SentimentResult[]): number {
  if (!items.length) return 0;
  return items.reduce((sum, it) => sum + it.sentiment, 0) / items.length;
}

function aggregateLabel(score: number): string {
  if (score >= 0.75) return "Strong Bullish";
  if (score >= 0.25) return "Bullish";
  if (score > -0.25) return "Neutral";
  if (score > -0.75) return "Bearish";
  return "Strong Bearish";
}

function returnColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  return pct >= 0 ? "text-teal" : "text-rose";
}

function sentimentBadgeClass(label: string): string {
  if (label.includes("Bullish")) return "bg-teal/15 text-teal border-teal/30";
  if (label.includes("Bearish")) return "bg-rose/15 text-rose border-rose/30";
  return "bg-muted-foreground/15 text-muted-foreground border-border";
}

/* ---------- Sub-components ---------- */

function SkeletonBar({ w = "full" }: { w?: string }) {
  return (
    <div className={`h-3 rounded bg-muted-foreground/20 animate-pulse w-${w}`} />
  );
}

function SentimentCard({ item }: { item: SentimentResult }) {
  return (
    <div
      className="rounded-lg border border-border bg-card/60 p-4 flex flex-col gap-2"
      data-testid={`sentiment-card-${item.symbol}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-base font-semibold">{item.symbol}</div>
        <span
          className={[
            "text-[10px] font-mono px-2 py-0.5 rounded-full border",
            sentimentBadgeClass(item.label),
          ].join(" ")}
        >
          {item.label}
        </span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono tabular text-foreground">
          {item.currentPrice != null
            ? `$${item.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : "—"}
        </span>
        <span className={`font-mono tabular ${returnColor(item.returnPct)}`}>
          {item.returnPct != null
            ? `${item.returnPct >= 0 ? "+" : ""}${item.returnPct.toFixed(2)}%`
            : "—"}
        </span>
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */

export function SentimentEngine({ holdings }: Props) {
  const { weeks, label } = useLookback();

  const symbols = holdings.map((h) => h.symbol).filter(Boolean);
  const hasHoldings = symbols.length > 0;

  const { data: results, isLoading } = useQuery<SentimentResult[]>({
    queryKey: ["/api/sentiment/batch", symbols.join(","), weeks],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/sentiment/batch", { symbols, weeks });
      return res.json();
    },
    enabled: hasHoldings,
    staleTime: 5 * 60 * 1000,
  });

  // Sort for buy/sell signal cards
  const sorted = results ? [...results].sort((a, b) => b.sentiment - a.sentiment) : [];
  const topBuys = sorted.slice(0, 3);
  const topSells = [...sorted].reverse().slice(0, 3);

  // Gauge
  const avg = results ? avgSentiment(results) : 0;
  const gaugePercent = sentimentToPercent(avg);
  const overallLabel = results ? aggregateLabel(avg) : "Neutral";

  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden"
      data-testid="card-sentiment-engine"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-0 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="eyebrow">MARKET SENTIMENT</div>
          <LookbackPills />
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* Empty state */}
        {!hasHoldings && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Add holdings or connect Plaid to see signals.
          </div>
        )}

        {/* Loading */}
        {hasHoldings && isLoading && (
          <div className="space-y-3">
            <SkeletonBar w="full" />
            <SkeletonBar w="3/4" />
            <SkeletonBar w="1/2" />
          </div>
        )}

        {/* Sentiment gauge */}
        {hasHoldings && results && (
          <>
            <div className="space-y-3">
              {/* Gradient bar */}
              <div className="relative h-5 rounded-full overflow-visible bg-gradient-to-r from-red-500 via-yellow-500 to-green-500">
                {/* Arrow marker */}
                <div
                  className="absolute top-0 -translate-x-1/2 pointer-events-none"
                  style={{ left: `${gaugePercent}%` }}
                >
                  {/* Downward-pointing triangle below bar */}
                  <div className="flex flex-col items-center">
                    <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-foreground" />
                  </div>
                </div>
              </div>

              {/* Labels row under bar */}
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>Bearish</span>
                <span>Neutral</span>
                <span>Bullish</span>
              </div>

              {/* Score + label */}
              <div className="flex items-baseline gap-3">
                <span className="font-display text-xl tabular">
                  {avg >= 0 ? "+" : ""}{avg.toFixed(2)}
                </span>
                <span
                  className={[
                    "text-xs font-mono px-2 py-0.5 rounded-full border",
                    sentimentBadgeClass(overallLabel),
                  ].join(" ")}
                >
                  {overallLabel}
                </span>
              </div>

              <div className="text-xs text-muted-foreground font-mono">
                across {results.length} position{results.length !== 1 ? "s" : ""}, last {label}
              </div>
            </div>

            {/* Buy / Sell signal cards */}
            {results.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                {/* Buy signals */}
                <div>
                  <div className="eyebrow mb-3 text-teal">Top buy signals</div>
                  <div className="space-y-2">
                    {topBuys.map((item) => (
                      <SentimentCard key={item.symbol} item={item} />
                    ))}
                  </div>
                </div>

                {/* Sell signals */}
                <div>
                  <div className="eyebrow mb-3 text-rose">Top sell signals</div>
                  <div className="space-y-2">
                    {topSells.map((item) => (
                      <SentimentCard key={item.symbol} item={item} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
