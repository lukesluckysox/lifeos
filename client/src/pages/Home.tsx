import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, MapPin, Calendar as CalIcon, Music as MusicIcon, Tv, LineChart, ArrowUpRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";
import { useLocation as useCity } from "@/components/LocationProvider";

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

/* ---------- Page ---------- */

export default function Home() {
  const { mode, withMode } = useMode();
  const { city } = useCity();

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

  /* Finance numbers */
  const plaidValue = portfolio?.plaid?.totalValue ?? 0;
  const manualValue = (portfolio?.manual ?? []).reduce((a, m) => a + (m.value || 0), 0);
  const netWorth = plaidValue + manualValue;
  const plaidDayChange = portfolio?.plaid?.dayChange ?? 0;
  const manualDayChange = (portfolio?.manual ?? []).reduce((a, m) => a + (m.value * (m.dayChangePct / 100) || 0), 0);
  const dayChange = plaidDayChange + manualDayChange;
  const dayChangePct = netWorth > 0 ? (dayChange / (netWorth - dayChange)) * 100 : 0;

  /* Places: top 3 sights */
  const topSights = (guide?.sights ?? []).slice(0, 3);
  /* Events: nearest 3 concerts */
  const upcomingConcerts = (concertsResp?.concerts ?? []).slice(0, 3);
  /* Music: top 4 tracks (recent) */
  const topTracks = (musicRecent?.tracks ?? []).slice(0, 4);
  /* Watch: top 3 from catalog */
  const topWatch = (catalog?.items ?? []).slice(0, 3);

  return (
    <div className="space-y-10 animate-fade-in">
      {/* ---- Editorial intro ---- */}
      <section className="pt-2">
        <div className="eyebrow mb-4">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          {mode === "demo" && <span className="ml-2 text-gold">· demo mode</span>}
        </div>
        <h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] leading-[1.02] tracking-tight max-w-3xl">
          The <span className="text-teal italic">state</span> of you, today.
        </h1>
      </section>

      <div className="hairline" />

      {/* ---- 5-card grid ---- */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">

        {/* ===== Finance ===== */}
        <DashboardCard
          href="/finance"
          icon={<LineChart size={14} className="text-teal" />}
          eyebrow="Finance"
          testId="card-home-finance"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Net worth · USD</div>
          <div className="font-display text-2xl leading-none tabular" data-testid="text-home-net-worth">
            ${netWorth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            {dayChange >= 0 ? <TrendingUp size={12} className="text-teal" /> : <TrendingDown size={12} className="text-rose" />}
            <span className={`${dayChange >= 0 ? "text-teal" : "text-rose"} tabular font-mono`}>
              {dayChange >= 0 ? "+" : "−"}${Math.abs(dayChange).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className={`tabular font-mono ${dayChange >= 0 ? "text-teal" : "text-rose"}`}>
              ({dayChange >= 0 ? "+" : ""}{dayChangePct.toFixed(2)}%)
            </span>
            <span className="text-muted-foreground">today</span>
          </div>
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
        </DashboardCard>

        {/* ===== Places ===== */}
        <DashboardCard
          href="/places"
          icon={<MapPin size={14} className="text-teal" />}
          eyebrow={`Places · ${guide?.city ?? city}`}
          testId="card-home-places"
        >
          <div className="font-display text-lg leading-tight mb-3">Top sights</div>
          {topSights.length > 0 ? (
            <ul className="space-y-2.5">
              {topSights.map((s, i) => (
                <li key={`${s.name}-${i}`} className="text-sm leading-snug flex items-start gap-2" data-testid={`item-home-sight-${i}`}>
                  <span className="mt-1 h-1 w-1 rounded-full bg-teal shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium truncate block" title={s.name}>{s.name}</span>
                    <span className="text-xs text-muted-foreground line-clamp-1">{s.note}</span>
                  </span>
                  {s.pinned && (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-teal border border-teal/40 rounded px-1 py-0.5 shrink-0">
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

        {/* ===== Events ===== */}
        <DashboardCard
          href="/events"
          icon={<CalIcon size={14} className="text-teal" />}
          eyebrow={`Events · ${city}`}
          testId="card-home-events"
        >
          <div className="font-display text-lg leading-tight mb-3">Concerts for you</div>
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

        {/* ===== Music ===== */}
        <DashboardCard
          href="/music"
          icon={<MusicIcon size={14} className="text-teal" />}
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

        {/* ===== Watch ===== */}
        <DashboardCard
          href="/watch"
          icon={<Tv size={14} className="text-teal" />}
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
                    <span className="font-mono text-[9px] uppercase tracking-wider text-teal border border-teal/40 rounded px-1 py-0.5 shrink-0">
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

      </section>

      <div className="hairline" />
      <footer className="pb-12">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xl text-muted-foreground italic">Radius</span>
          <span className="eyebrow">a personal command room</span>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Sub-components ---------- */

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
      <div className="group relative rounded-xl border border-border bg-card/70 hover:bg-card hover:border-teal/40 transition-colors p-5 cursor-pointer h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 eyebrow">
            {icon}
            <span>{eyebrow}</span>
          </div>
          <ArrowUpRight
            size={14}
            className="text-muted-foreground group-hover:text-teal transition-colors"
          />
        </div>
        <div className="flex-1">{children}</div>
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
      <div className={`font-mono tabular text-xs ${positive ? "text-teal" : "text-rose"}`}>
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
  const lineColor = positive ? "hsl(var(--teal, 178 56% 51%))" : "hsl(var(--rose, 350 65% 60%))";
  const fillColor = positive ? "rgba(79, 152, 163, 0.18)" : "rgba(209, 99, 167, 0.18)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none" data-testid="sparkline-home-portfolio">
      <path d={area} fill={fillColor} />
      <path d={line} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
