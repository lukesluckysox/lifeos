import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Plus, X, RefreshCw, Eye, Sparkles, ArrowUpRight, Building2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { PlaidConnect } from "@/components/PlaidConnect";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";
import { useToast } from "@/hooks/use-toast";
import { RecFeedback } from "@/components/RecFeedback";
import { FinanceInsights } from "@/components/FinanceInsights";
import { Link } from "wouter";
import { PillTabs } from "@/components/PillTabs";
import { useTabParam } from "@/hooks/useTabParam";
import Subscriptions from "@/pages/Subscriptions";
import { LookbackProvider } from "@/components/LookbackContext";
import { LookbackPills } from "@/components/LookbackPills";
import { SentimentEngine } from "@/components/SentimentEngine";
import { OptimalAllocation } from "@/components/OptimalAllocation";
import { ETFTiles } from "@/components/ETFTiles";
import { CategoryLeaders } from "@/components/CategoryLeaders";

/* ---------- Types ---------- */

interface PlaidHolding { ticker: string; name: string; value: number; dayChangePct: number; gainPct: number; quantity?: number; price?: number }
interface ManualHolding { id: number; kind: "stock" | "crypto"; symbol: string; name: string; quantity: number; costBasis: number; price: number; value: number; dayChangePct: number; gainPct: number }
interface PortfolioResp {
  source: string;
  mode: string;
  plaid: {
    totalValue: number; dayChange: number; dayChangePct: number;
    totalGain: number; totalGainPct: number; positions: number;
    holdings: PlaidHolding[];
  } | null;
  manual: ManualHolding[];
}
interface WatchItem { id: number; kind: "stock" | "crypto"; symbol: string; name: string | null; note: string | null; createdAt: number; price: number | null; dayChangePct: number | null }
interface RecItem { symbol: string; name: string; reason: string; basedOn: string; kind: "stock" | "crypto"; price: number | null; dayChangePct: number | null }
interface RecsResp { recommendations: RecItem[]; basedOnTickers: string[] }
interface BullBearItem { symbol: string; bull: string; bear: string }
interface BullBearResp { items: BullBearItem[]; asOf: string; seed: number }
interface MoverItem { symbol: string; name: string; price: number; dayChangePct: number; dayChangeAbs: number; marketCap?: number; volume?: number }
interface MoversResp { gainers: MoverItem[]; losers: MoverItem[]; asOf: string }
interface IndexQuoteResp { symbol: string; kind: string; name: string; currentPrice: number; oneYearReturnPct: number; ytdReturnPct: number; series: { t: number; p: number }[] }
interface PlaidItemRow { id: number; itemId: string; institutionName: string; createdAt: number }

/* ---------- Component ---------- */

function FinanceMain() {
  const { mode, withMode } = useMode();
  const { toast } = useToast();

  /* Portfolio (Plaid + manual or demo snapshot) */
  const { data: portfolio } = useQuery<PortfolioResp>({
    queryKey: ["/api/portfolio", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/portfolio"))).json(),
  });

  /* Connected brokerages (real Plaid items) — hidden in demo mode */
  const { data: plaidItems } = useQuery<PlaidItemRow[]>({
    queryKey: ["/api/plaid/items"],
    queryFn: async () => (await apiRequest("GET", "/api/plaid/items")).json(),
    enabled: mode !== "demo",
  });

  /* Combined holdings */
  const plaidHoldings = portfolio?.plaid?.holdings ?? [];
  const manualHoldings = portfolio?.manual ?? [];
  const plaidValue = portfolio?.plaid?.totalValue ?? 0;
  const manualValue = manualHoldings.reduce((s, h) => s + h.value, 0);
  const netWorth = plaidValue + manualValue;

  const plaidDayChange = portfolio?.plaid?.dayChange ?? 0;
  const manualDayChange = manualHoldings.reduce((s, h) => s + (h.value * (h.dayChangePct / 100)), 0);
  const dayChange = plaidDayChange + manualDayChange;
  const dayChangePct = netWorth > 0 ? (dayChange / (netWorth - dayChange)) * 100 : 0;

  // Blended return %: weighted avg of plaid totalGainPct and manual gainPct
  const plaidCost = portfolio?.plaid ? (plaidValue - (portfolio.plaid.totalGain || 0)) : 0;
  const manualCost = manualHoldings.reduce((s, h) => s + h.quantity * h.costBasis, 0);
  const totalCost = plaidCost + manualCost;
  const blendedGainPct = totalCost > 0 ? ((netWorth - totalCost) / totalCost) * 100 : 0;

  /* Allocation rows (top 12 by value) */
  const allocRows = [
    ...plaidHoldings.map(h => ({ symbol: h.ticker, name: h.name, value: h.value, dayChangePct: h.dayChangePct, source: "plaid" as const })),
    ...manualHoldings.map(h => ({ symbol: h.symbol, name: h.name, value: h.value, dayChangePct: h.dayChangePct, source: "manual" as const })),
  ]
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)
    .map(r => ({ ...r, weight: netWorth > 0 ? (r.value / netWorth) * 100 : 0 }));

  /* Read narrative */
  const topConcentration = allocRows[0];
  const biggestMover = [...allocRows].sort((a, b) => Math.abs(b.dayChangePct) - Math.abs(a.dayChangePct))[0];

  /* Index comparison */
  const [indexSym, setIndexSym] = useState("SPY");
  const { data: indexQuote, isLoading: indexLoading } = useQuery<IndexQuoteResp>({
    queryKey: ["/api/index-quote", indexSym],
    queryFn: async () => (await apiRequest("GET", `/api/index-quote/${indexSym}`)).json(),
  });

  /* Manual entry form */
  const [form, setForm] = useState({ kind: "stock" as "stock" | "crypto", symbol: "", quantity: "", costBasis: "" });
  const addHolding = useMutation({
    mutationFn: async () => {
      const body = {
        kind: form.kind,
        symbol: form.symbol.toUpperCase().trim(),
        quantity: parseFloat(form.quantity),
        costBasis: parseFloat(form.costBasis),
      };
      return (await apiRequest("POST", "/api/holdings", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      setForm({ kind: "stock", symbol: "", quantity: "", costBasis: "" });
      toast({ title: "Holding added" });
    },
    onError: (e: any) => toast({ title: "Could not add", description: e.message, variant: "destructive" }),
  });
  const deleteHolding = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/holdings/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] }),
  });

  /* Watchlist */
  const { data: watchlist = [] } = useQuery<WatchItem[]>({
    queryKey: ["/api/watchlist", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/watchlist"))).json(),
  });
  const [wForm, setWForm] = useState({ kind: "stock" as "stock" | "crypto", symbol: "", note: "" });
  const addWatch = useMutation({
    mutationFn: async () => {
      const body = { kind: wForm.kind, symbol: wForm.symbol.toUpperCase().trim(), note: wForm.note.trim() || undefined };
      return (await apiRequest("POST", "/api/watchlist", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      setWForm({ kind: "stock", symbol: "", note: "" });
      toast({ title: "Added to watchlist" });
    },
    onError: (e: any) => toast({ title: "Could not add", description: e.message, variant: "destructive" }),
  });
  const deleteWatch = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/watchlist/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] }),
  });

  /* Recommendations */
  const { data: recsData } = useQuery<RecsResp>({
    queryKey: ["/api/recommendations", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/recommendations"))).json(),
  });
  const recs = recsData?.recommendations ?? [];

  /* Market movers (replaces Bull/Bear) */
  const { data: movers, isFetching: moversLoading, refetch: refetchMovers } = useQuery<MoversResp>({
    queryKey: ["/api/market-movers"],
    queryFn: async () => (await apiRequest("GET", "/api/market-movers")).json(),
  });

  const indexOptions = ["SPY", "QQQ", "VTI", "VOO", "BTC", "ETH", "SOL"];

  const sentimentHoldings = [
    ...plaidHoldings.map(h => ({ symbol: h.ticker })),
    ...manualHoldings.map(h => ({ symbol: h.symbol })),
  ];

  // Holdings with dollar value — used by OptimalAllocation for weighting
  const valuedHoldings = [
    ...plaidHoldings.map(h => ({ symbol: h.ticker, value: h.value, name: h.name })),
    ...manualHoldings.map(h => ({ symbol: h.symbol, value: h.value, name: h.name })),
  ];

  return (
    <LookbackProvider>
    <div className="space-y-16 animate-fade-in">
      {/* ============ Connected brokerages strip (real Plaid items) ============ */}
      {mode !== "demo" && plaidItems && plaidItems.length > 0 && (
        <div
          className="flex items-center gap-2 flex-wrap text-xs font-mono uppercase tracking-wider text-muted-foreground -mb-10"
          data-testid="strip-connected-brokerages"
        >
          <Building2 size={12} className="text-teal" />
          <span className="text-muted-foreground/70">Connected</span>
          {plaidItems.map((it, idx) => (
            <span key={it.id} className="flex items-center gap-2">
              <span
                className="rounded-full border border-teal/30 bg-teal/5 text-foreground/90 px-2 py-0.5 normal-case tracking-normal"
                data-testid={`chip-brokerage-${it.id}`}
              >
                {it.institutionName}
              </span>
              {idx < plaidItems.length - 1 && <span className="text-muted-foreground/40">·</span>}
            </span>
          ))}
        </div>
      )}

      {/* ============ Net worth headline ============ */}
      <section>
        <div className="eyebrow mb-3">
          Finance {mode === "demo" && <span className="ml-2 text-gold">· demo</span>}
        </div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Net worth · USD</div>
            <div
              className="font-display text-[clamp(2.5rem,5vw,4rem)] leading-none tabular"
              data-testid="text-net-worth"
            >
              ${netWorth.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              {dayChange >= 0 ? <TrendingUp size={14} className="text-teal" /> : <TrendingDown size={14} className="text-rose" />}
              <span className={`${dayChange >= 0 ? "text-teal" : "text-rose"} tabular font-mono`}>
                {dayChange >= 0 ? "+" : "-"}${Math.abs(dayChange).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span className={`tabular font-mono ${dayChange >= 0 ? "text-teal" : "text-rose"}`}>
                ({dayChange >= 0 ? "+" : ""}{dayChangePct.toFixed(2)}%)
              </span>
              <span className="text-muted-foreground">today</span>
            </div>
          </div>
          <div className="flex gap-8">
            <Metric label="Plaid" value={`$${plaidValue.toLocaleString(undefined,{maximumFractionDigits:0})}`} sub={`${portfolio?.plaid?.positions ?? 0} positions`} />
            <Metric label="Manual" value={`$${manualValue.toLocaleString(undefined,{maximumFractionDigits:0})}`} sub={`${manualHoldings.length} entries`} />
            <Metric label="Lifetime" value={totalCost ? `${blendedGainPct >= 0 ? "+" : ""}${blendedGainPct.toFixed(1)}%` : "—"} sub="blended" />
          </div>
        </div>

        {/* Global lookback — every metric below recalculates against this window */}
        <div className="mt-6 flex items-center gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Lookback</div>
          <LookbackPills />
        </div>
      </section>

      <div className="hairline" />

      {/* ============ Sentiment engine ============ */}
      <SentimentEngine holdings={sentimentHoldings} />

      {/* ============ Optimal allocation + what-if ============ */}
      <OptimalAllocation holdings={valuedHoldings} />

      {/* ============ ETF tiles ============ */}
      <ETFTiles />

      {/* ============ Category leaders ============ */}
      <CategoryLeaders />

      {/* ============ Plaid brokerage connect ============ */}
      {mode !== "demo" && <PlaidConnect />}

      {/* ============ Advisory insights ============ */}
      <FinanceInsights />

      <div className="hairline" />

      {/* ============ Allocation + Index comparison ============ */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-10">
        <div>
          <SectionHeader eyebrow="Allocation" title="Where it sits" />
          {allocRows.length === 0 ? (
            <EmptyCard label="No holdings yet" sub="Connect Plaid or add holdings manually below." />
          ) : (
            <>
              <AllocationBar rows={allocRows} />
              <div className="mt-6 space-y-1.5">
                {allocRows.map(r => (
                  <div
                    key={`${r.source}-${r.symbol}`}
                    data-testid={`row-holding-${r.symbol}`}
                    className="flex items-center gap-4 text-sm py-2 border-b border-border/40 last:border-0"
                  >
                    <div className="font-mono text-foreground font-medium w-16">{r.symbol}</div>
                    <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">{r.name}</div>
                    <div className="font-mono tabular text-muted-foreground w-16 text-right">{r.weight.toFixed(1)}%</div>
                    <div className={`font-mono tabular w-20 text-right ${r.dayChangePct >= 0 ? "text-teal" : "text-rose"}`}>
                      {r.dayChangePct >= 0 ? "+" : ""}{r.dayChangePct.toFixed(2)}%
                    </div>
                    <div className="font-mono tabular w-24 text-right text-foreground">
                      ${r.value.toLocaleString(undefined,{maximumFractionDigits:0})}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <SectionHeader eyebrow="Benchmark" title="vs. an index" />
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap gap-1.5 mb-4">
              {indexOptions.map(s => (
                <button
                  key={s}
                  onClick={() => setIndexSym(s)}
                  data-testid={`button-index-${s}`}
                  className={`text-xs font-mono px-2.5 py-1 rounded-md border transition-colors ${indexSym === s ? "bg-teal/15 border-teal/40 text-teal" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            {indexLoading ? (
              <div className="h-32 grid place-items-center text-xs text-muted-foreground">Loading…</div>
            ) : indexQuote ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="eyebrow mb-1">{indexSym} YTD</div>
                    <div className={`font-display text-2xl tabular ${indexQuote.ytdReturnPct >= 0 ? "text-teal" : "text-rose"}`}>
                      {indexQuote.ytdReturnPct >= 0 ? "+" : ""}{indexQuote.ytdReturnPct.toFixed(2)}%
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-1">@ ${indexQuote.currentPrice.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                  </div>
                  <div>
                    <div className="eyebrow mb-1">You · blended</div>
                    <div className={`font-display text-2xl tabular ${blendedGainPct >= 0 ? "text-teal" : "text-rose"}`}>
                      {totalCost ? `${blendedGainPct >= 0 ? "+" : ""}${blendedGainPct.toFixed(2)}%` : "—"}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-1">lifetime gain</div>
                  </div>
                </div>
                <div className="pt-3 border-t border-border/60">
                  <div className="eyebrow mb-1">{indexSym} 1y</div>
                  <div className={`font-mono tabular text-sm ${indexQuote.oneYearReturnPct >= 0 ? "text-teal" : "text-rose"}`}>
                    {indexQuote.oneYearReturnPct >= 0 ? "+" : ""}{indexQuote.oneYearReturnPct.toFixed(2)}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No data.</div>
            )}
          </div>
        </div>
      </section>

      {/* ============ Read narrative ============ */}
      {allocRows.length > 0 && (
        <section>
          <SectionHeader eyebrow="Read" title="The short version" />
          <div className="rounded-lg border border-border bg-card p-6 max-w-3xl">
            <p className="font-display text-xl leading-snug text-foreground">
              {topConcentration && (
                <>
                  Your biggest position is <span className="italic text-teal">{topConcentration.symbol}</span>
                  {" "}at {topConcentration.weight.toFixed(1)}% of net worth.
                </>
              )}
              {biggestMover && Math.abs(biggestMover.dayChangePct) > 0.1 && (
                <>
                  {" "}{biggestMover.symbol} did most of today's work
                  <span className={biggestMover.dayChangePct >= 0 ? "text-teal" : "text-rose"}>
                    {" "}({biggestMover.dayChangePct >= 0 ? "+" : ""}{biggestMover.dayChangePct.toFixed(2)}%).
                  </span>
                </>
              )}
            </p>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              {indexQuote && totalCost > 0 && (
                <>
                  Your blended return is{" "}
                  {blendedGainPct - indexQuote.ytdReturnPct >= 0
                    ? `ahead of ${indexSym} YTD by ${(blendedGainPct - indexQuote.ytdReturnPct).toFixed(2)} pts.`
                    : `trailing ${indexSym} YTD by ${(indexQuote.ytdReturnPct - blendedGainPct).toFixed(2)} pts.`}
                </>
              )}
              {portfolio?.source === "demo" && " This is sample data for sharing."}
            </p>
          </div>
        </section>
      )}

      {/* ============ Manual entry ============ */}
      <section>
        <SectionHeader eyebrow="Add holding" title="Manual entry" />
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr_1fr_auto] gap-2">
            <select
              value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value as any })}
              className="h-9 px-2 rounded-md border border-border bg-background text-sm font-mono"
              data-testid="select-holding-kind"
            >
              <option value="stock">stock</option>
              <option value="crypto">crypto</option>
            </select>
            <input
              placeholder="Symbol (e.g. NVDA)"
              value={form.symbol}
              onChange={e => setForm({ ...form, symbol: e.target.value })}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm font-mono"
              data-testid="input-holding-symbol"
            />
            <input
              placeholder="Quantity"
              type="number"
              step="any"
              value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm font-mono"
              data-testid="input-holding-quantity"
            />
            <input
              placeholder="Cost basis"
              type="number"
              step="any"
              value={form.costBasis}
              onChange={e => setForm({ ...form, costBasis: e.target.value })}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm font-mono"
              data-testid="input-holding-cost"
            />
            <button
              disabled={addHolding.isPending || !form.symbol || !form.quantity || !form.costBasis || mode === "demo"}
              onClick={() => addHolding.mutate()}
              data-testid="button-add-holding"
              className="h-9 px-4 rounded-md bg-teal text-background text-sm font-medium hover:bg-teal/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Add
            </button>
          </div>
          {mode === "demo" && (
            <div className="mt-3 text-xs text-muted-foreground">Manual entries are disabled in demo mode.</div>
          )}

          {manualHoldings.length > 0 && (
            <div className="mt-5 space-y-1">
              {manualHoldings.map(h => (
                <div
                  key={h.id}
                  data-testid={`row-manual-${h.symbol}`}
                  className="flex items-center gap-3 text-sm py-2 border-t border-border/40"
                >
                  <div className="font-mono w-16">{h.symbol}</div>
                  <div className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{h.name}</div>
                  <div className="font-mono tabular text-xs text-muted-foreground w-20 text-right">{h.quantity} @ ${h.costBasis}</div>
                  <div className="font-mono tabular w-24 text-right">${h.value.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                  <div className={`font-mono tabular w-20 text-right ${h.gainPct >= 0 ? "text-teal" : "text-rose"}`}>
                    {h.gainPct >= 0 ? "+" : ""}{h.gainPct.toFixed(2)}%
                  </div>
                  <button
                    onClick={() => deleteHolding.mutate(h.id)}
                    data-testid={`button-delete-holding-${h.id}`}
                    className="p-1 text-muted-foreground hover:text-rose transition-colors"
                    aria-label="Delete holding"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ============ Watchlist ============ */}
      <section>
        <SectionHeader eyebrow="Watching" title="Watchlist" />
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_2fr_auto] gap-2">
            <select
              value={wForm.kind}
              onChange={e => setWForm({ ...wForm, kind: e.target.value as any })}
              className="h-9 px-2 rounded-md border border-border bg-background text-sm font-mono"
              data-testid="select-watch-kind"
            >
              <option value="stock">stock</option>
              <option value="crypto">crypto</option>
            </select>
            <input
              placeholder="Symbol"
              value={wForm.symbol}
              onChange={e => setWForm({ ...wForm, symbol: e.target.value })}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm font-mono"
              data-testid="input-watch-symbol"
            />
            <input
              placeholder="Note (optional)"
              value={wForm.note}
              onChange={e => setWForm({ ...wForm, note: e.target.value })}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm"
              data-testid="input-watch-note"
            />
            <button
              disabled={addWatch.isPending || !wForm.symbol || mode === "demo"}
              onClick={() => addWatch.mutate()}
              data-testid="button-add-watch"
              className="h-9 px-4 rounded-md bg-teal text-background text-sm font-medium hover:bg-teal/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Eye size={14} /> Watch
            </button>
          </div>
          {mode === "demo" && (
            <div className="mt-3 text-xs text-muted-foreground">Watchlist additions disabled in demo mode.</div>
          )}

          {watchlist.length === 0 ? (
            <div className="mt-5 text-sm text-muted-foreground py-4 text-center">Nothing on watch yet.</div>
          ) : (
            <div className="mt-5 space-y-1">
              {watchlist.map(w => (
                <div
                  key={w.id}
                  data-testid={`row-watch-${w.symbol}`}
                  className="flex items-center gap-3 text-sm py-2 border-t border-border/40"
                >
                  <div className="font-mono w-16">{w.symbol}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground truncate">{w.name || w.symbol}</div>
                    {w.note && <div className="text-[11px] text-muted-foreground/70 italic truncate">{w.note}</div>}
                  </div>
                  <div className="font-mono tabular w-24 text-right">
                    {w.price != null ? `$${w.price.toLocaleString(undefined,{maximumFractionDigits:2})}` : "—"}
                  </div>
                  <div className={`font-mono tabular w-20 text-right ${(w.dayChangePct ?? 0) >= 0 ? "text-teal" : "text-rose"}`}>
                    {w.dayChangePct != null ? `${w.dayChangePct >= 0 ? "+" : ""}${w.dayChangePct.toFixed(2)}%` : "—"}
                  </div>
                  {w.id > 0 && (
                    <button
                      onClick={() => deleteWatch.mutate(w.id)}
                      data-testid={`button-delete-watch-${w.id}`}
                      className="p-1 text-muted-foreground hover:text-rose transition-colors"
                      aria-label="Remove from watchlist"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ============ Recommendations ============ */}
      <section>
        <SectionHeader eyebrow="Adjacent" title="Similar to what you hold" />
        {recs.length === 0 ? (
          <EmptyCard label="No recommendations yet" sub="Add a few holdings first — we'll suggest sector and theme peers." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recs.map(r => (
              <div
                key={r.symbol}
                data-testid={`card-rec-${r.symbol}`}
                className="rounded-lg border border-border bg-card p-4 hover:border-teal/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-mono text-sm font-medium">{r.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">{r.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono tabular text-sm">
                      {r.price != null ? `$${r.price.toLocaleString(undefined,{maximumFractionDigits:2})}` : "—"}
                    </div>
                    <div className={`font-mono tabular text-[11px] ${(r.dayChangePct ?? 0) >= 0 ? "text-teal" : "text-rose"}`}>
                      {r.dayChangePct != null ? `${r.dayChangePct >= 0 ? "+" : ""}${r.dayChangePct.toFixed(2)}%` : ""}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">{r.reason}</div>
                <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
                  <RecFeedback
                    kind="finance"
                    externalId={r.symbol}
                    why={`Adjacent to ${r.basedOn}`}
                    reason={r.reason}
                    title={`${r.symbol} \u2014 ${r.name}`}
                    meta={{ symbol: r.symbol, name: r.name, kind: r.kind, basedOn: r.basedOn }}
                    compact
                    className="flex-1 min-w-0"
                  />
                  <button
                    onClick={() => {
                      setWForm({ kind: r.kind, symbol: r.symbol, note: `${r.reason} (based on ${r.basedOn})` });
                      window.scrollTo({ top: document.body.scrollHeight * 0.55, behavior: "smooth" });
                    }}
                    data-testid={`button-watch-rec-${r.symbol}`}
                    className="text-[11px] font-mono text-teal hover:underline underline-offset-2 inline-flex items-center gap-1 shrink-0"
                  >
                    <Eye size={11} /> watch
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ Market movers (market-wide) ============ */}
      <section data-testid="section-market-movers">
        <div className="flex items-end justify-between mb-5 gap-4">
          <div>
            <div className="eyebrow mb-1">Market today</div>
            <h2 className="font-display text-xl leading-tight">Biggest gainers & losers</h2>
          </div>
          <button
            onClick={() => refetchMovers()}
            disabled={moversLoading}
            data-testid="button-refresh-movers"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-mono text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={moversLoading ? "animate-spin" : ""} /> refresh
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <MoversColumn title="Top 5 Gainers" items={movers?.gainers ?? []} positive />
          <MoversColumn title="Top 5 Losers" items={movers?.losers ?? []} positive={false} />
        </div>
      </section>

      {/* ============ Subscriptions link ============ */}
      <section>
        <Link href="/subscriptions" data-testid="link-subscriptions">
          <div className="flex items-center justify-between rounded-lg border border-border bg-card hover:border-teal/40 px-5 py-4 cursor-pointer transition-colors">
            <div>
              <div className="eyebrow">Audit</div>
              <div className="font-display text-lg">Recurring subscriptions</div>
              <div className="text-xs text-muted-foreground mt-1">Auto-detected from your transactions + manual entries.</div>
            </div>
            <ArrowUpRight size={18} className="text-muted-foreground" />
          </div>
        </Link>
      </section>
    </div>
    </LookbackProvider>
  );
}

function MoversColumn({ title, items, positive }: { title: string; items: MoverItem[]; positive: boolean }) {
  const color = positive ? "text-teal" : "text-rose";
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden" data-testid={`movers-${positive ? "gainers" : "losers"}`}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="font-display text-base">{title}</div>
        {positive ? <TrendingUp size={14} className="text-teal" /> : <TrendingDown size={14} className="text-rose" />}
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">Loading market data…</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it, i) => (
            <li key={`${it.symbol}-${i}`} className="px-4 py-3 flex items-center gap-3" data-testid={`mover-${it.symbol}`}>
              <div className="font-mono text-[10px] tabular text-muted-foreground w-5">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm font-medium">{it.symbol}</div>
                <div className="text-[11px] text-muted-foreground truncate" title={it.name}>{it.name}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono tabular text-sm">${it.price.toFixed(2)}</div>
                <div className={`font-mono tabular text-[11px] ${color}`}>
                  {it.dayChangePct >= 0 ? "+" : ""}{it.dayChangePct.toFixed(2)}%
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="font-display text-2xl tabular leading-none">{value}</div>
      <div className="font-mono text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{sub}</div>
    </div>
  );
}

function AllocationBar({ rows }: { rows: { symbol: string; weight: number }[] }) {
  const palette = ["bg-teal", "bg-gold", "bg-rose", "bg-foreground/70", "bg-muted-foreground/60", "bg-foreground/45", "bg-teal/60", "bg-gold/60", "bg-rose/60", "bg-foreground/30", "bg-muted-foreground/40", "bg-foreground/20"];
  return (
    <div>
      <div className="flex h-12 rounded-md overflow-hidden border border-border">
        {rows.map((r, i) => (
          <div
            key={r.symbol}
            className={`${palette[i % palette.length]} transition-opacity hover:opacity-80`}
            style={{ width: `${r.weight}%` }}
            title={`${r.symbol} · ${r.weight.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-mono uppercase tracking-wider">
        {rows.map((r, i) => (
          <span key={r.symbol} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${palette[i % palette.length]}`} />
            {r.symbol}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyCard({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 px-6 py-10 text-center">
      <div className="font-display text-lg">{label}</div>
      <div className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">{sub}</div>
    </div>
  );
}

/* ============ Finance wrapper with Subscriptions tab ============ */
type FinanceTab = "portfolio" | "subscriptions";
const FINANCE_TABS = [
  { id: "portfolio" as const, label: "Portfolio" },
  { id: "subscriptions" as const, label: "Subscriptions" },
];

export default function Finance() {
  const [tab, setTab] = useTabParam<FinanceTab>("portfolio");
  const active: FinanceTab = tab === "subscriptions" ? "subscriptions" : "portfolio";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="eyebrow">Finance</div>
        <PillTabs tabs={FINANCE_TABS} value={active} onChange={setTab} testIdPrefix="tab-finance" />
      </div>
      {active === "portfolio" ? <FinanceMain /> : <Subscriptions />}
    </div>
  );
}
