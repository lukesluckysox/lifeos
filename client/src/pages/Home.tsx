import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import { TrendingUp, TrendingDown, MapPin, Calendar as CalIcon, Music as MusicIcon, Tv, LineChart, ArrowUpRight, Check, X, Sparkles, Compass } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { TopPickPill, type TopPickDomain } from "@/components/TopPickPill";
import { useMode } from "@/components/ModeProvider";
import { useLocation as useCity } from "@/components/LocationProvider";
import { useAuth } from "@/components/AuthProvider";
import { useCountUp } from "@/hooks/useCountUp";

/* ---------- Types ---------- */

interface PortfolioResp {
  source: string;
  mode: string;
  plaid: {
    totalValue: number; dayChange: number; dayChangePct: number;
    totalGain: number; totalGainPct: number; positions: number;
    holdings: Array<{ ticker: string; name: string; value: number; dayChangePct: number; gainPct: number }>;
  } | null;
  manual: Array<{ symbol: string; name: string; value: number; dayChangePct: number; gainPct: number }>;
}
interface HistoryResp {
  points: { t: string; v: number }[];
  currentValue: number;
  sixMonthReturnPct: number;
  oneMonthReturnPct: number;
  dayReturnPct: number;
}
interface Track {
  id: string; name: string; artist: string; image?: string; url?: string; popularity?: number;
}
interface MusicResp { source: string; tracks: Track[]; }
interface Concert { artist: string; venue: string; city: string; date: string; url?: string; }
interface ConcertsResp { source: string; city: string; concerts: Concert[]; }
type Sight = { name: string; note: string; pinned?: boolean };
type TravelGuide = { city: string; sights: Sight[]; curated: boolean };
interface CatalogItem { id: string; kind: "show" | "film"; title: string; year: number; pinned?: boolean; }
interface CatalogResp { source: string; items: CatalogItem[]; }
interface InsightItem { kind: string; severity: "info" | "watch" | "alert"; title: string; detail: string; }
interface InsightsResp { insights: InsightItem[]; totalValue: number; asOf: string; }
interface Neighborhood { name: string; note: string; }
interface TodayGuide { city: string; sights: Array<{ name: string; note: string; }>; neighborhoods: Neighborhood[]; }
interface NWEntry { id: number; kind: string; label: string; value: number; }
interface CashTotalResp { total: number; accountCount: number; }

/* ---------- Page ---------- */

export default function Home() {
  const { mode, withMode } = useMode();
  const { city } = useCity();
  const { user } = useAuth();
  const firstName = (user?.displayName || "").split(" ")[0] || "there";
  const hour = new Date().getHours();
  const partOfDay = hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "tonight";

  const { data: portfolio } = useQuery<PortfolioResp>({
    queryKey: ["/api/portfolio", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/portfolio"))).json(),
  });
  const { data: portfolioHistory } = useQuery<HistoryResp>({
    queryKey: ["/api/portfolio-history", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/portfolio-history"))).json(),
  });
  const { data: musicRecent } = useQuery<MusicResp>({
    queryKey: ["/api/music-recs", mode, "recent"],
    queryFn: async () => {
      const base = withMode("/api/music-recs");
      const url = base + (base.includes("?") ? "&" : "?") + "section=recent";
      return (await apiRequest("GET", url)).json();
    },
  });
  const { data: concertsResp } = useQuery<ConcertsResp>({
    queryKey: ["/api/concerts-for-you", mode, city],
    queryFn: async () => (await apiRequest("GET", withMode(`/api/concerts-for-you?city=${encodeURIComponent(city)}`))).json(),
  });
  const { data: guide } = useQuery<TravelGuide>({
    queryKey: ["/api/travel-guide", city],
    queryFn: async () => (await apiRequest("GET", withMode(`/api/travel-guide?city=${encodeURIComponent(city)}`))).json(),
  });
  const { data: catalog } = useQuery<CatalogResp>({
    queryKey: ["/api/catalog", "home"],
    queryFn: async () => (await apiRequest("GET", "/api/catalog")).json(),
  });
  const { data: insights } = useQuery<InsightsResp>({
    queryKey: ["/api/finance-insights", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/finance-insights"))).json(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: todayGuide } = useQuery<TodayGuide>({
    queryKey: ["/api/travel-guide", city],
    queryFn: async () => (await apiRequest("GET", withMode(`/api/travel-guide?city=${encodeURIComponent(city)}`))).json(),
  });
  const { data: nwEntries = [] } = useQuery<NWEntry[]>({
    queryKey: ["/api/net-worth"],
    queryFn: async () => (await apiRequest("GET", "/api/net-worth")).json(),
    enabled: !!user,
  });
  // Manual savings/cash accounts (no ticker, no Plaid) — see
  // server/cash-accounts-routes.ts. Only the accounts the user opted
  // into "include in portfolio" are summed here.
  const { data: cashTotalResp } = useQuery<CashTotalResp>({
    queryKey: ["/api/cash-accounts/total"],
    queryFn: async () => (await apiRequest("GET", "/api/cash-accounts/total")).json(),
    enabled: !!user,
  });

  /* Finance numbers */
  const plaidValue = portfolio?.plaid?.totalValue ?? 0;
  const manualValue = (portfolio?.manual ?? []).reduce((a, m) => a + (m.value || 0), 0);
  const cashValue = cashTotalResp?.total ?? 0;
  const netWorth = plaidValue + manualValue + cashValue;
  const plaidDayChange = portfolio?.plaid?.dayChange ?? 0;
  const manualDayChange = (portfolio?.manual ?? []).reduce((a, m) => a + (m.value * (m.dayChangePct / 100) || 0), 0);
  // Cash accounts have no price feed, so they contribute 0 to day change
  // by definition — a savings balance doesn't move until you edit it.
  const dayChange = plaidDayChange + manualDayChange;
  const dayChangePct = netWorth > 0 ? (dayChange / (netWorth - dayChange)) * 100 : 0;

  /* Net worth tracker */
  const NW_ASSET_KINDS = ["asset_investment","asset_cash","asset_property","asset_vehicle","asset_other"];
  const NW_DEBT_KINDS = ["debt_mortgage","debt_auto","debt_student","debt_credit","debt_other"];
  const nwTotalAssets = nwEntries.filter(e => NW_ASSET_KINDS.includes(e.kind)).reduce((s,e)=>s+e.value,0);
  const nwTotalDebt = nwEntries.filter(e => NW_DEBT_KINDS.includes(e.kind)).reduce((s,e)=>s+e.value,0);
  const nwNetWorth = nwTotalAssets - nwTotalDebt;
  const hasNWData = nwEntries.length > 0;

  /* Finance narrative */
  const topInsight = (insights?.insights ?? [])[0];
  const bigMover = (insights?.insights ?? []).find(i => i.kind === "mover");
  const concentration = (insights?.insights ?? []).find(i => i.kind === "concentration");

  /* Today in city */
  const todaySight = (todayGuide?.sights ?? []).filter(s => !s.pinned)[0];
  const todayNeighborhood = (todayGuide?.neighborhoods ?? [])[0];
  const upcomingEvent = (concertsResp?.concerts ?? [])[0];

  /* Places: top 3 sights */
  const topSights = (guide?.sights ?? []).slice(0, 3);
  /* Events: nearest 3 concerts */
  const upcomingConcerts = (concertsResp?.concerts ?? []).slice(0, 3);
  /* Music: top 4 tracks (recent) */
  const topTracks = (musicRecent?.tracks ?? []).slice(0, 4);
  /* Watch: top 3 from catalog */
  const topWatch = (catalog?.items ?? []).slice(0, 3);

  /* Hero ticker numbers */
  const trackCount = (musicRecent?.tracks ?? []).length;
  const showCount = upcomingConcerts.length;

  /* Onboarding status (only fetched when user is signed in) */
  const { data: onboarding } = useQuery<{
    steps: { id: string; label: string; done: boolean; href?: string }[];
    completedCount: number;
    totalCount: number;
    hidden: boolean;
  }>({
    queryKey: ["/api/onboarding-status"],
    queryFn: async () => (await apiRequest("GET", "/api/onboarding-status")).json(),
    enabled: !!user,
  });

  return (
    <div className="space-y-10 animate-fade-in">
      {/* ---- First-run checklist (auto-hides once dismissed) ---- */}
      {onboarding && !onboarding.hidden && (
        <OnboardingChecklist
          steps={onboarding.steps}
          completedCount={onboarding.completedCount}
          totalCount={onboarding.totalCount}
        />
      )}

      {/* ---- Hero greeting ---- */}
      <HeroGreeting
        firstName={firstName}
        partOfDay={partOfDay}
        dateLabel={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        mode={mode}
        dayChange={dayChange}
        dayChangePct={dayChangePct}
        trackCount={trackCount}
        showCount={showCount}
        city={city}
      />

      {/* ---- Finance narrative strip ---- */}
      {netWorth > 0 && (
        <FinanceNarrative
          dayChange={dayChange}
          dayChangePct={dayChangePct}
          bigMover={bigMover}
          concentration={concentration}
        />
      )}

      {/* ---- Today in the city ---- */}
      {(todaySight || todayNeighborhood || upcomingEvent) && (
        <TodayInCity
          city={city}
          sight={todaySight}
          neighborhood={todayNeighborhood}
          event={upcomingEvent}
        />
      )}

      <div className="hairline" />

      {/* ---- 5-card grid ---- */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">

        {/* ===== Finance ===== */}
        <HomeCardWithPill domain="stock">
          <DashboardCard
            href="/finance"
            icon={<LineChart size={13} className="text-blue" />}
            eyebrow="Finance"
            testId="card-home-finance"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Net worth · USD</div>
            <div className="font-display text-2xl leading-none tabular" data-testid="text-home-net-worth">
              ${netWorth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            {netWorth > 0 ? (
              <>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {dayChange >= 0 ? <TrendingUp size={12} className="text-blue" /> : <TrendingDown size={12} className="text-rose" />}
                  <span className={`${dayChange >= 0 ? "text-blue" : "text-rose"} tabular font-mono`}>
                    {dayChange >= 0 ? "+" : "−"}${Math.abs(dayChange).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className={`tabular font-mono ${dayChange >= 0 ? "text-blue" : "text-rose"}`}>
                    ({dayChange >= 0 ? "+" : ""}{dayChangePct.toFixed(2)}%)
                  </span>
                  <span className="text-muted-foreground">today</span>
                </div>
                {cashValue > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                    incl. ${cashValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} in savings
                  </div>
                )}
                {portfolioHistory && portfolioHistory.points.length > 1 && (
                  <div className="mt-4">
                    <Sparkline points={portfolioHistory.points} positive={(portfolioHistory.sixMonthReturnPct ?? 0) >= 0} />
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-3 pt-3 border-t border-border/40">
                  <Stat label="1d" pct={portfolioHistory?.dayReturnPct} />
                  <Stat label="1m" pct={portfolioHistory?.oneMonthReturnPct} />
                  <Stat label="6m" pct={portfolioHistory?.sixMonthReturnPct} />
                </div>
              </>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Connect a brokerage or add a holding to track your portfolio.
              </div>
            )}
          </DashboardCard>
        </HomeCardWithPill>

        {/* ===== Net Worth ===== */}
        {hasNWData && (
          <DashboardCard
            href="/settings"
            icon={<TrendingUp size={13} className="text-blue" />}
            eyebrow="Net Worth"
            testId="card-home-net-worth"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Total · USD</div>
            <div className={`font-display text-2xl leading-none tabular ${nwNetWorth >= 0 ? "" : "text-rose"}`} data-testid="text-home-nw-tracker">
              {nwNetWorth < 0 ? "-" : ""}${Math.abs(nwNetWorth).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 pt-3 border-t border-border/40">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Assets</div>
                <div className="font-mono text-sm tabular text-green">${nwTotalAssets.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Debt</div>
                <div className="font-mono text-sm tabular text-rose">${nwTotalDebt.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              </div>
            </div>
          </DashboardCard>
        )}

        {/* ===== Places ===== */}
        <HomeCardWithPill domain="place">
          <DashboardCard
            href="/places"
            icon={<MapPin size={13} className="text-blue" />}
            eyebrow={`Places · ${guide?.city ?? city}`}
            testId="card-home-places"
          >
            <div className="text-sm font-semibold text-foreground/80 mb-3">Top sights</div>
            {topSights.length > 0 ? (
              <ul className="space-y-2.5">
                {topSights.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="text-sm leading-snug flex items-start gap-2" data-testid={`item-home-sight-${i}`}>
                    <span className="mt-1 h-1 w-1 rounded-full bg-blue shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium truncate block" title={s.name}>{s.name}</span>
                      <span className="text-xs text-muted-foreground line-clamp-1">{s.note}</span>
                    </span>
                    {s.pinned && (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-blue border border-blue/30 rounded px-1 py-0.5 shrink-0">
                        pinned
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>Add a place or change city.</EmptyHint>
            )}
          </DashboardCard>
        </HomeCardWithPill>

        {/* ===== Events ===== */}
        <HomeCardWithPill domain="event">
          <DashboardCard
            href="/events"
            icon={<CalIcon size={13} className="text-blue" />}
            eyebrow={`Events · ${city}`}
            testId="card-home-events"
          >
            <div className="text-sm font-semibold text-foreground/80 mb-3">Concerts for you</div>
            {upcomingConcerts.length > 0 ? (
              <ul className="space-y-2.5">
                {upcomingConcerts.map((c, i) => (
                  <li key={`${c.artist}-${i}`} className="text-sm leading-snug flex items-baseline gap-3" data-testid={`item-home-concert-${i}`}>
                    <span className="font-mono text-[10px] tabular text-muted-foreground shrink-0 w-16">{formatDate(c.date)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium truncate block" title={c.artist}>{c.artist}</span>
                      <span className="text-xs text-muted-foreground truncate block" title={c.venue}>{c.venue}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>No shows yet. Add an artist to follow.</EmptyHint>
            )}
          </DashboardCard>
        </HomeCardWithPill>

        {/* ===== Music ===== */}
        <HomeCardWithPill domain="artist">
          <DashboardCard
            href="/music"
            icon={<MusicIcon size={13} className="text-blue" />}
            eyebrow="Music · recently played"
            testId="card-home-music"
          >
            {topTracks.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {topTracks.map((t) => (
                  <div key={t.id} className="space-y-1.5" data-testid={`item-home-track-${t.id}`}>
                    <div className="aspect-square rounded-md bg-muted/40 overflow-hidden border border-border/40">
                      {t.image ? (
                        <img src={t.image} alt={t.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-[8px] font-mono uppercase tracking-wider text-muted-foreground">no art</div>
                      )}
                    </div>
                    <div className="text-[11px] leading-tight font-medium truncate" title={t.name}>{t.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate" title={t.artist}>{t.artist}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyHint>Connect Spotify for live listening.</EmptyHint>
            )}
          </DashboardCard>
        </HomeCardWithPill>

        {/* ===== Watch ===== */}
        <HomeCardWithPill domain="show">
          <DashboardCard
            href="/watch"
            icon={<Tv size={13} className="text-blue" />}
            eyebrow="Watch · for tonight"
            testId="card-home-watch"
          >
            {topWatch.length > 0 ? (
              <ul className="space-y-2.5">
                {topWatch.map((it) => (
                  <li key={it.id} className="text-sm leading-snug flex items-baseline gap-3" data-testid={`item-home-watch-${it.id}`}>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground shrink-0 w-12">{it.kind} · {it.year || "—"}</span>
                    <span className="font-medium truncate flex-1" title={it.title}>{it.title}</span>
                    {it.pinned && (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-blue border border-blue/30 rounded px-1 py-0.5 shrink-0">
                        pinned
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint>Rate a few titles to seed your taste.</EmptyHint>
            )}
          </DashboardCard>
        </HomeCardWithPill>

      </section>

      <div className="hairline" />
      <footer className="pb-12 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-display text-xl text-muted-foreground italic">LifeOS</span>
          <span className="eyebrow">your money, your music, your places</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <a
            href="https://traces.up.railway.app"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue transition-colors inline-flex items-center gap-1"
            data-testid="link-footer-atlas"
          >
            Atlas · the sibling app
            <ArrowUpRight size={10} />
          </a>
          <span className="text-muted-foreground/40">·</span>
          <span>made in Hawaii</span>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Sub-components ---------- */

// Wraps a Home dashboard card with its TOP pick pill below.
// Keeps the grid happy: each child of the grid is still a single column item.
function HomeCardWithPill({
  domain,
  children,
}: {
  domain: TopPickDomain;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {children}
      <TopPickPill domain={domain} compact className="self-start max-w-full" />
    </div>
  );
}

function DashboardCard({
  href, icon, eyebrow, children, testId,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Link href={href} data-testid={testId}>
      <div className="group dash-card overflow-hidden cursor-pointer flex flex-col">
        {/* Header zone — distinct surface from card body */}
        <div className="dash-card-header flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 eyebrow">
            {icon}
            <span>{eyebrow}</span>
          </div>
          <ArrowUpRight
            size={13}
            className="text-muted-foreground/40 group-hover:text-blue transition-colors"
          />
        </div>
        {/* Card body */}
        <div className="px-4 py-4 flex-1">{children}</div>
      </div>
    </Link>
  );
}

function Stat({ label, pct }: { label: string; pct?: number }) {
  const v = pct ?? 0;
  const positive = v >= 0;
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className={`font-mono tabular text-xs ${positive ? "text-blue" : "text-rose"}`}>
        {pct == null ? "—" : `${positive ? "+" : ""}${v.toFixed(1)}%`}
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground italic py-2">{children}</div>
  );
}

function Sparkline({ points, positive }: { points: { t: string; v: number }[]; positive: boolean }) {
  const w = 280;
  const h = 50;
  const vals = points.map((p) => p.v);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = Math.max(maxV - minV, 1);
  const xStep = w / (points.length - 1);
  const coords = points.map((p, i) => ({
    x: i * xStep,
    y: h - (h - 2) * ((p.v - minV) / range) - 1,
  }));
  const line = coords.map((c, i) => (i === 0 ? `M${c.x},${c.y}` : `L${c.x},${c.y}`)).join(" ");
  const area = `${line} L${coords[coords.length - 1].x},${h} L${coords[0].x},${h} Z`;
  const lineColor = positive ? "hsl(var(--accent-blue))" : "hsl(var(--rose, 350 65% 60%))";
  const fillColor = positive ? "rgba(79, 152, 163, 0.18)" : "rgba(209, 99, 167, 0.18)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none" data-testid="sparkline-home-portfolio">
      <path d={area} fill={fillColor} />
      <path d={line} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OnboardingChecklist({
  steps, completedCount, totalCount,
}: {
  steps: { id: string; label: string; done: boolean; href?: string }[];
  completedCount: number;
  totalCount: number;
}) {
  const [dismissing, setDismissing] = useState(false);
  const allCoreDone = steps.filter(s => s.id !== "dismiss").every(s => s.done);
  const pct = Math.round((completedCount / totalCount) * 100);

  const dismiss = async () => {
    setDismissing(true);
    try {
      await apiRequest("POST", "/api/auth/onboarding-completed");
      await queryClient.invalidateQueries({ queryKey: ["/api/onboarding-status"] });
    } catch {
      setDismissing(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-blue/20 bg-blue/5 p-5"
      data-testid="section-home-onboarding"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-blue mb-1">Getting started · {pct}%</div>
          <h2 className="font-display text-lg leading-tight">
            {allCoreDone ? "You're all set — dismiss this?" : "Connect a few things to make LifeOS yours."}
          </h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={dismissing}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-onboarding-dismiss"
          title="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="space-y-2">
        {steps.filter(s => s.id !== "dismiss").map((s) => (
          <li key={s.id} className="flex items-center gap-3 text-sm">
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${
                s.done ? "bg-blue text-white" : "bg-card border border-border"
              }`}
              data-testid={`onboarding-step-${s.id}-${s.done ? "done" : "pending"}`}
            >
              {s.done && <Check size={12} />}
            </span>
            {s.done ? (
              <span className="text-muted-foreground line-through">{s.label}</span>
            ) : s.href ? (
              <Link href={s.href}>
                <span className="hover:text-blue transition-colors cursor-pointer" data-testid={`link-onboarding-${s.id}`}>
                  {s.label}
                </span>
              </Link>
            ) : (
              <span>{s.label}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HeroGreeting({
  firstName, partOfDay, dateLabel, mode, dayChange, dayChangePct, trackCount, showCount, city,
}: {
  firstName: string;
  partOfDay: string;
  dateLabel: string;
  mode: string;
  dayChange: number;
  dayChangePct: number;
  trackCount: number;
  showCount: number;
  city: string;
}) {
  const positive = dayChange >= 0;
  const animatedChange = useCountUp(Math.abs(dayChange));
  return (
    <section className="pt-2" data-testid="section-home-hero">
      <div className="eyebrow mb-4">
        {dateLabel}
        {mode === "demo" && <span className="ml-2 text-gold">· demo mode</span>}
      </div>
      <h1 className="font-display text-[clamp(1.875rem,4vw,3rem)] leading-[1.05] tracking-tight max-w-3xl">
        Good {partOfDay}, <span className="text-blue italic">{firstName}</span>.
      </h1>
      <p className="mt-3 text-base text-muted-foreground max-w-2xl leading-relaxed" data-testid="text-home-hero-summary">
        {Math.abs(dayChange) > 0 ? (
          <>
            Your portfolio is{" "}
            <span className={`font-mono tabular ${positive ? "text-blue" : "text-rose"}`}>
              {positive ? "+" : "−"}${Math.round(animatedChange).toLocaleString()}
            </span>{" "}
            <span className={`font-mono tabular ${positive ? "text-blue" : "text-rose"}`}>
              ({positive ? "+" : ""}{dayChangePct.toFixed(2)}%)
            </span>{" "}
            today.
          </>
        ) : (
          <>Here's what's on your radar today.</>
        )}
        {trackCount > 0 && (
          <>
            {" "}You've played{" "}
            <span className="text-foreground tabular">{trackCount}</span>{" "}
            track{trackCount === 1 ? "" : "s"} recently.
          </>
        )}
        {showCount > 0 && (
          <>
            {" "}<span className="text-foreground tabular">{showCount}</span>{" "}
            show{showCount === 1 ? "" : "s"} coming up in {city}.
          </>
        )}
      </p>
    </section>
  );
}

function formatDate(iso?: string) {
  if (!iso) return "TBA";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso || "TBA";
  }
}

/* ---------- Finance Narrative strip ---------- */
function FinanceNarrative({
  dayChange, dayChangePct, bigMover, concentration,
}: {
  dayChange: number;
  dayChangePct: number;
  bigMover?: { title: string; detail: string } | undefined;
  concentration?: { title: string; detail: string } | undefined;
}) {
  const positive = dayChange >= 0;
  const hasChange = Math.abs(dayChange) > 0.5;

  // Build a 1-2 sentence plain-English read.
  const parts: string[] = [];
  if (hasChange) {
    parts.push(
      `Portfolio ${positive ? "up" : "down"} $${Math.abs(dayChange).toLocaleString(undefined, { maximumFractionDigits: 0 })} (${positive ? "+" : ""}${dayChangePct.toFixed(2)}%) today.`
    );
  }
  if (bigMover) {
    // Strip the ticker prefix — already in the title, keep it short
    parts.push(bigMover.title + ".");
  } else if (concentration) {
    parts.push(concentration.title + ".");
  }
  if (parts.length === 0) return null;

  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-border bg-card/40 px-5 py-4"
      data-testid="section-finance-narrative"
    >
      <LineChart size={14} className={`mt-[3px] shrink-0 ${positive ? "text-blue" : "text-rose"}`} />
      <p className="text-sm text-muted-foreground leading-relaxed">
        {parts.map((p, i) => (
          <span key={i}>{i > 0 && " "}{p}</span>
        ))}
        {" "}
        <Link href="/finance">
          <span className="text-blue hover:underline underline-offset-2 cursor-pointer font-mono text-xs uppercase tracking-wider">
            Full view →
          </span>
        </Link>
      </p>
    </div>
  );
}

/* ---------- Today in the city ---------- */
function TodayInCity({
  city, sight, neighborhood, event,
}: {
  city: string;
  sight?: { name: string; note: string };
  neighborhood?: { name: string; note: string };
  event?: { artist: string; venue: string; date: string; url?: string };
}) {
  return (
    <section data-testid="section-today-in-city">
      <div className="flex items-center gap-2 mb-3">
        <Compass size={13} className="text-blue" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Today in {city}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {sight && (
          <Link href="/places">
            <div
              className="group rounded-xl border border-border bg-card/60 hover:bg-card hover:border-blue/30 transition-colors p-4 cursor-pointer"
              data-testid="today-card-sight"
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2 flex items-center gap-1">
                <MapPin size={9} /> Top sight
              </div>
              <div className="font-display text-base leading-tight mb-1">{sight.name}</div>
              <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{sight.note}</div>
            </div>
          </Link>
        )}
        {neighborhood && (
          <Link href="/places">
            <div
              className="group rounded-xl border border-border bg-card/60 hover:bg-card hover:border-blue/30 transition-colors p-4 cursor-pointer"
              data-testid="today-card-neighborhood"
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2 flex items-center gap-1">
                <Compass size={9} /> Neighborhood
              </div>
              <div className="font-display text-base leading-tight mb-1">{neighborhood.name}</div>
              <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{neighborhood.note}</div>
            </div>
          </Link>
        )}
        {event && (
          <Link href="/events">
            <div
              className="group rounded-xl border border-border bg-card/60 hover:bg-card hover:border-blue/30 transition-colors p-4 cursor-pointer"
              data-testid="today-card-event"
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-2 flex items-center gap-1">
                <CalIcon size={9} /> Up next
              </div>
              <div className="font-display text-base leading-tight mb-1">{event.artist}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {event.venue} · {formatDate(event.date)}
              </div>
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}
