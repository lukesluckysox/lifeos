import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLookback } from "@/components/LookbackContext";

/* ---------- Types ---------- */

interface SignalReason {
  tag: string;
  weight: number;
  detail?: string;
}

interface SentimentResult {
  symbol: string;
  currentPrice: number | null;
  returnPct: number | null;
  sentiment: number; // composite -1..+1
  label: string;     // Strong Buy / Buy / Hold / Sell / Strong Sell
  reasons?: SignalReason[];
  factors?: {
    momentum: number | null;
    trend: number | null;
    drawdown: number | null;
    rsi: number | null;
    rsiSignal: number | null;
    volatilityPct: number | null;
    sharpe: number | null;
  };
  action?: string;
  conviction?: number; // 1..3
}

interface Props {
  holdings: { symbol: string }[];
}

/* ---------- Helpers ---------- */

function sentimentToPercent(s: number): number {
  return ((s + 1) / 2) * 100;
}

function avgSentiment(items: SentimentResult[]): number {
  if (!items.length) return 0;
  return items.reduce((sum, it) => sum + it.sentiment, 0) / items.length;
}

function overallLabelFromAvg(score: number): string {
  if (score >= 0.5) return "Risk-on";
  if (score >= 0.15) return "Constructive";
  if (score > -0.15) return "Mixed";
  if (score > -0.5) return "Defensive";
  return "Risk-off";
}

function badgeClassForLabel(label: string): string {
  if (label === "Strong Buy") return "bg-teal/20 text-teal border-teal/40";
  if (label === "Buy")         return "bg-teal/12 text-teal border-teal/25";
  if (label === "Sell")        return "bg-rose/12 text-rose border-rose/25";
  if (label === "Strong Sell") return "bg-rose/20 text-rose border-rose/40";
  if (label === "Risk-on" || label === "Constructive") return "bg-teal/15 text-teal border-teal/30";
  if (label === "Defensive" || label === "Risk-off") return "bg-rose/15 text-rose border-rose/30";
  return "bg-muted-foreground/15 text-muted-foreground border-border";
}

function priceText(p: number | null): string {
  if (p == null) return "—";
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: p < 10 ? 4 : 2 })}`;
}

function pctText(p: number | null): string {
  if (p == null) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function returnColor(p: number | null): string {
  if (p == null) return "text-muted-foreground";
  return p >= 0 ? "text-teal" : "text-rose";
}

/* ---------- Sub-components ---------- */

function SkeletonBar({ w = "full" }: { w?: string }) {
  return <div className={`h-3 rounded bg-muted-foreground/20 animate-pulse w-${w}`} />;
}

function ConvictionDots({ n }: { n: number }) {
  const dots = [1, 2, 3];
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Conviction ${n} of 3`}>
      {dots.map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i <= n ? "bg-foreground" : "bg-muted-foreground/25"}`}
        />
      ))}
    </span>
  );
}

function ReasonChip({ r, sign }: { r: SignalReason; sign: "buy" | "sell" }) {
  // Chip color reflects whether the reason supports the card's direction
  const positive = sign === "buy" ? r.weight > 0 : r.weight < 0;
  const cls = positive
    ? "border-foreground/20 text-foreground/85 bg-foreground/5"
    : "border-muted-foreground/15 text-muted-foreground bg-transparent";
  return (
    <span
      title={r.detail}
      className={`inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-full border ${cls}`}
    >
      {r.tag}
    </span>
  );
}

function SignalCard({ item, sign }: { item: SentimentResult; sign: "buy" | "sell" }) {
  const reasons = item.reasons ?? [];
  const accent = sign === "buy" ? "text-teal" : "text-rose";
  const borderAccent = sign === "buy" ? "border-teal/25 bg-teal/[0.03]" : "border-rose/25 bg-rose/[0.03]";

  return (
    <div
      className={`rounded-lg border ${borderAccent} p-4 flex flex-col gap-3 transition-colors`}
      data-testid={`sentiment-card-${item.symbol}`}
    >
      {/* Header: symbol, label, conviction */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-base font-semibold text-foreground">{item.symbol}</span>
            <span className="font-mono tabular text-[11px] text-muted-foreground">
              {priceText(item.currentPrice)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${badgeClassForLabel(item.label)}`}
              data-testid={`signal-label-${item.symbol}`}
            >
              {item.label}
            </span>
            <ConvictionDots n={item.conviction ?? 1} />
          </div>
        </div>
        <div className={`font-mono tabular text-sm ${returnColor(item.returnPct)} text-right whitespace-nowrap`}>
          {pctText(item.returnPct)}
        </div>
      </div>

      {/* Reason chips */}
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((r, i) => (
            <ReasonChip key={`${r.tag}-${i}`} r={r} sign={sign} />
          ))}
        </div>
      )}

      {/* Action line — the poignant bit */}
      {item.action && (
        <div className={`text-xs leading-snug ${accent}`} data-testid={`signal-action-${item.symbol}`}>
          {item.action}
        </div>
      )}
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

  // Sort: top buys by descending sentiment (must be > 0 to qualify),
  //       top sells by ascending sentiment (must be < 0 to qualify).
  // Within each side, conviction breaks ties.
  const sorted = results ? [...results].sort((a, b) => b.sentiment - a.sentiment) : [];
  const topBuys = sorted
    .filter((r) => r.sentiment > 0.1)
    .slice(0, 3);
  const topSells = [...sorted]
    .reverse()
    .filter((r) => r.sentiment < -0.1)
    .slice(0, 3);

  // Gauge
  const avg = results ? avgSentiment(results) : 0;
  const gaugePercent = sentimentToPercent(avg);
  const overallLabel = results ? overallLabelFromAvg(avg) : "Mixed";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden" data-testid="card-sentiment-engine">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-0 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="eyebrow">Signal engine</div>
          <span className="font-mono text-[10px] text-muted-foreground/70">{label}</span>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {!hasHoldings && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Add holdings or connect Plaid to see signals.
          </div>
        )}

        {hasHoldings && isLoading && (
          <div className="space-y-3">
            <SkeletonBar w="full" />
            <SkeletonBar w="3/4" />
            <SkeletonBar w="1/2" />
          </div>
        )}

        {hasHoldings && results && (
          <>
            {/* Gauge */}
            <div className="space-y-3">
              <div className="relative h-5 rounded-full overflow-visible bg-gradient-to-r from-red-500 via-yellow-500 to-green-500">
                <div
                  className="absolute top-0 -translate-x-1/2 pointer-events-none"
                  style={{ left: `${gaugePercent}%` }}
                >
                  <div className="flex flex-col items-center">
                    <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-foreground" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>Risk-off</span>
                <span>Mixed</span>
                <span>Risk-on</span>
              </div>

              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-display text-xl tabular">
                  {avg >= 0 ? "+" : ""}{avg.toFixed(2)}
                </span>
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded-full border ${badgeClassForLabel(overallLabel)}`}
                >
                  {overallLabel}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  across {results.length} position{results.length !== 1 ? "s" : ""} · last {label}
                </span>
              </div>
            </div>

            {/* Buy / Sell signal cards */}
            {results.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
                {/* Buy signals */}
                <div>
                  <div className="flex items-baseline justify-between mb-3">
                    <div className="eyebrow text-teal">Top buy signals</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{topBuys.length} flagged</div>
                  </div>
                  {topBuys.length > 0 ? (
                    <div className="space-y-2.5">
                      {topBuys.map((item) => (
                        <SignalCard key={item.symbol} item={item} sign="buy" />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
                      Nothing screaming buy in this window. The book is rangebound.
                    </div>
                  )}
                </div>

                {/* Sell signals */}
                <div>
                  <div className="flex items-baseline justify-between mb-3">
                    <div className="eyebrow text-rose">Top sell signals</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{topSells.length} flagged</div>
                  </div>
                  {topSells.length > 0 ? (
                    <div className="space-y-2.5">
                      {topSells.map((item) => (
                        <SignalCard key={item.symbol} item={item} sign="sell" />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
                      No structural sell flags in this window. Holds are holding.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quiet disclaimer */}
            <div className="pt-4 border-t border-border/60">
              <p className="text-[10.5px] text-muted-foreground/70 leading-relaxed font-mono">
                Signals blend momentum, 50-day trend, RSI(14), drawdown and risk-adjusted return.
                Educational only — not advice. Past performance ≠ future returns.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
