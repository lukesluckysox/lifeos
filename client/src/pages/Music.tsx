import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TopPickPill } from "@/components/TopPickPill";
import { ExternalLink, RefreshCw, Music as MusicIcon, Disc3, CalendarClock, Plug, TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";

/* ─────────────────────────────────────────────────────────────────────── */
/* Types                                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

interface GenreBucket {
  genre: string;
  count: number;
  artists: Array<{ id: string; name: string; url?: string; image?: string }>;
  lastPlayedAt?: string;
  sampleTrack?: { name: string; artist: string; image?: string; url?: string };
}

interface GenreResp {
  source: string;
  genres?: GenreBucket[];
  asOf?: string;
}

interface Release {
  id: string;
  name: string;
  artist: string;
  album?: string;
  image?: string;
  releaseDate?: string;
  albumType?: string;
  url?: string;
  isUpcoming?: boolean;
}

interface ReleasesResp {
  source: string;
  tracks?: Release[];
  asOf?: string;
}

interface MoodResp {
  source: string;
  score?: number;
  valence?: number;
  energy?: number;
  label?: string;
  delta?: number;
  drivers?: string[];
  asOf?: string;
  reason?: string;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

function timeAgo(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "";
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function formatRelease(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}


/* ─────────────────────────────────────────────────────────────────────── */
/* Listening Identity — hero card                                          */
/* ─────────────────────────────────────────────────────────────────────── */

function ListeningIdentity({ data, isLoading }: { data?: MoodResp; isLoading: boolean }) {
  if (isLoading && !data) {
    return (
      <div className="rounded-2xl border border-border bg-card/40 p-8 animate-pulse" data-testid="identity-skeleton">
        <div className="h-3 w-24 bg-secondary/50 rounded mb-6" />
        <div className="h-10 w-56 bg-secondary/50 rounded mb-6" />
        <div className="flex gap-4 mb-6">
          <div className="flex-1 h-1.5 bg-secondary/50 rounded-full" />
          <div className="flex-1 h-1.5 bg-secondary/50 rounded-full" />
        </div>
        <div className="flex gap-2">
          {[1,2,3].map(i => <div key={i} className="h-6 w-16 bg-secondary/50 rounded-full" />)}
        </div>
      </div>
    );
  }

  if (!data || data.source === "unauthorized" || data.source === "no-data" || typeof data.score !== "number") {
    return (
      <div className="rounded-2xl border border-border bg-card/40 px-6 py-5 text-xs text-muted-foreground flex items-center gap-2" data-testid="identity-empty">
        <Sparkles size={12} className="text-muted-foreground/50" />
        {data?.reason === "no-listening-history"
          ? "Play some tracks on Spotify, then refresh — we'll read your sound."
          : "Connect Spotify to see your listening identity."}
      </div>
    );
  }

  const valence = data.valence ?? 50;
  const energy = data.energy ?? 50;
  const delta = data.delta ?? 0;
  const DeltaIcon = delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus;
  const deltaSign = delta > 0 ? "+" : "";
  const deltaTone = delta > 1 ? "text-teal" : delta < -1 ? "text-destructive" : "text-muted-foreground";

  return (
    <div
      className="relative rounded-2xl border border-border bg-card overflow-hidden"
      data-testid="identity-hero"
    >
      {/* Subtle gradient backdrop that shifts with valence + energy */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 25% 60%, hsl(${184 + (valence - 50) * 0.5} 42% 56%), transparent 65%),
                       radial-gradient(ellipse at 75% 40%, hsl(${258 - (energy - 50) * 0.7} 36% 52%), transparent 65%)`,
        }}
      />

      <div className="relative p-7 sm:p-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60 mb-4">
          Your sound right now
        </div>

        {/* Big label + delta */}
        <div className="flex items-baseline gap-4 flex-wrap mb-7">
          <span
            className="font-display text-[clamp(2rem,5vw,3.25rem)] leading-none tracking-tight"
            data-testid="identity-label"
          >
            {data.label || "Mixed"}
          </span>
          <span
            className={`inline-flex items-center gap-1 font-mono text-sm tabular ${deltaTone}`}
            data-testid="identity-delta"
          >
            <DeltaIcon size={13} />{deltaSign}{delta}
          </span>
        </div>

        {/* Valence + Energy — thin bars, no numbers cluttering the hero */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-7 max-w-xs">
          {([
            { label: "Valence", value: valence },
            { label: "Energy",  value: energy  },
          ] as const).map(({ label, value }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">{label}</span>
                <span className="font-mono text-[10px] tabular text-muted-foreground/70">{value}</span>
              </div>
              <div className="h-[3px] w-full rounded-full bg-secondary/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-foreground/50 transition-all duration-700"
                  style={{ width: `${value}%` }}
                  data-testid={`bar-${label.toLowerCase()}`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Driver genre pills */}
        {data.drivers && data.drivers.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/50 mr-1">Driven by</span>
            {data.drivers.map((g) => (
              <span
                key={g}
                className="inline-flex items-center rounded-full border border-border bg-secondary/30 px-3 py-1 text-xs text-foreground/80"
                data-testid={`chip-genre-${g.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {(data.source === "heuristic" || data.source === "heuristic-fallback") && (
          <div className="mt-4 text-[10px] font-mono text-muted-foreground/40">fallback reading — AI scorer offline</div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Mood Ticker — stock-ticker style strip                                  */
/* ─────────────────────────────────────────────────────────────────────── */

function MoodTicker({ data, isLoading }: { data?: MoodResp; isLoading: boolean }) {
  // Skeleton during initial fetch — keep same height so layout doesn't jump.
  if (isLoading && !data) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-5 animate-pulse" data-testid="ticker-mood-skeleton">
        <div className="h-3 w-24 bg-secondary/50 rounded mb-3" />
        <div className="h-7 w-48 bg-secondary/50 rounded mb-3" />
        <div className="flex gap-1.5">
          <div className="h-5 w-16 bg-secondary/50 rounded-full" />
          <div className="h-5 w-20 bg-secondary/50 rounded-full" />
          <div className="h-5 w-14 bg-secondary/50 rounded-full" />
        </div>
      </div>
    );
  }

  // Not connected or no data — show subtle empty hint, not a hard error.
  if (!data || data.source === "unauthorized" || data.source === "no-data" || typeof data.score !== "number") {
    return (
      <div
        className="rounded-lg border border-border bg-card/40 px-5 py-4 text-xs text-muted-foreground flex items-center gap-2"
        data-testid="ticker-mood-empty"
      >
        <Sparkles size={12} className="text-muted-foreground/60" />
        {data?.reason === "no-listening-history"
          ? "Play some tracks on Spotify, then refresh — we'll read your mood."
          : "Connect Spotify to read your mood."}
      </div>
    );
  }

  const score = data.score ?? 50;
  const delta = data.delta ?? 0;
  const valence = data.valence ?? 50;
  const energy = data.energy ?? 50;

  // Color logic: warm (teal/green-ish) for upbeat, cooler for somber.
  // We use the existing 'teal' accent for positive movement, muted for flat,
  // 'destructive' tone for sharply negative delta (rare but possible).
  const deltaTone =
    delta > 1 ? "text-teal" : delta < -1 ? "text-destructive" : "text-muted-foreground";
  const DeltaIcon = delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus;
  const deltaSign = delta > 0 ? "+" : "";

  // Track-style mood bar gradient: red→amber→teal as score rises.
  // Position the indicator at score%.
  return (
    <div
      className="rounded-lg border border-border bg-card/40 p-5"
      data-testid="ticker-mood"
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-1">
            Mood index · from your listening
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="font-display text-xl leading-tight tabular"
              data-testid="text-mood-label"
            >
              {data.label || "Mixed"}
            </span>
            <span className="font-mono text-sm text-muted-foreground tabular">
              {score}
              <span className="text-muted-foreground/50">/100</span>
            </span>
            <span
              className={`inline-flex items-center gap-1 font-mono text-[11px] tabular ${deltaTone}`}
              data-testid="text-mood-delta"
              title="Change since last reading"
            >
              <DeltaIcon size={11} />
              {deltaSign}
              {delta}
            </span>
          </div>
        </div>

        {/* V / E mini-gauges */}
        <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 shrink-0">
          <div className="flex flex-col items-end gap-1">
            <span>Valence</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 rounded-full bg-secondary/50 overflow-hidden">
                <div
                  className="h-full bg-teal/70 transition-all duration-700"
                  style={{ width: `${valence}%` }}
                  data-testid="bar-valence"
                />
              </div>
              <span className="tabular text-foreground/80 w-6 text-right">{valence}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span>Energy</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 rounded-full bg-secondary/50 overflow-hidden">
                <div
                  className="h-full bg-foreground/60 transition-all duration-700"
                  style={{ width: `${energy}%` }}
                  data-testid="bar-energy"
                />
              </div>
              <span className="tabular text-foreground/80 w-6 text-right">{energy}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Drivers row — like a ticker tape */}
      {data.drivers && data.drivers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 self-center">
            driven by
          </span>
          {data.drivers.map((g) => (
            <span
              key={g}
              className="inline-flex items-center rounded-full bg-secondary/40 px-2 py-0.5 text-[11px] text-foreground/80"
              data-testid={`chip-driver-${g.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {data.source === "heuristic" || data.source === "heuristic-fallback" || data.source === "parse-fallback" ? (
        <div className="mt-3 text-[10px] font-mono text-muted-foreground/50">
          fallback reading — AI scorer offline
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Sub-components                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

function GenreCard({ bucket, eyebrow }: { bucket: GenreBucket; eyebrow?: string }) {
  return (
    <div
      className="rounded-lg border border-border bg-card/40 p-4 hover:border-border/80 transition-colors"
      data-testid={`card-genre-${bucket.genre.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          {eyebrow && (
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70 mb-1">
              {eyebrow}
            </div>
          )}
          <div
            className="font-display text-base leading-tight"
            data-testid={`text-genre-name-${bucket.genre.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {bucket.genre}
          </div>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground tabular shrink-0">
          {bucket.count} track{bucket.count > 1 ? "s" : ""}
          {bucket.lastPlayedAt && <span className="mx-1.5">·</span>}
          {bucket.lastPlayedAt && timeAgo(bucket.lastPlayedAt)}
        </div>
      </div>

      {/* Sample artists row */}
      {bucket.artists.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bucket.artists.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target={a.url ? "_blank" : undefined}
              rel="noreferrer"
              data-testid={`link-artist-${a.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary/40 hover:bg-secondary/70 transition-colors px-2 py-1 text-xs"
            >
              {a.image ? (
                <img src={a.image} alt="" className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-secondary/80 grid place-items-center">
                  <MusicIcon size={8} className="text-muted-foreground" />
                </span>
              )}
              <span className="truncate max-w-[120px]">{a.name}</span>
            </a>
          ))}
        </div>
      )}

      {/* Sample track preview */}
      {bucket.sampleTrack && (
        <div className="mt-3 pt-3 border-t border-border/40 text-[11px] text-muted-foreground/80 truncate">
          <span className="text-muted-foreground/60">latest · </span>
          {bucket.sampleTrack.url ? (
            <a
              href={bucket.sampleTrack.url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground transition-colors"
            >
              {bucket.sampleTrack.name}
            </a>
          ) : (
            bucket.sampleTrack.name
          )}
        </div>
      )}
    </div>
  );
}

function GenreGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
          <div className="h-4 w-20 bg-secondary/50 rounded animate-pulse" />
          <div className="flex gap-1.5">
            <div className="h-5 w-16 bg-secondary/50 rounded-full animate-pulse" />
            <div className="h-5 w-20 bg-secondary/50 rounded-full animate-pulse" />
            <div className="h-5 w-14 bg-secondary/50 rounded-full animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReleaseRow({ release }: { release: Release }) {
  return (
    <a
      href={release.url}
      target={release.url ? "_blank" : undefined}
      rel="noreferrer"
      data-testid={`row-release-${release.id}`}
      className="flex items-center gap-3 px-3 py-2 hover:bg-accent/30 transition-colors group rounded"
    >
      {release.image ? (
        <img src={release.image} alt="" className="w-11 h-11 rounded shrink-0 object-cover" />
      ) : (
        <div className="w-11 h-11 rounded shrink-0 bg-secondary/50 grid place-items-center">
          <Disc3 size={14} className="text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-display text-sm leading-tight truncate flex items-center gap-2">
          <span className="truncate">{release.name}</span>
          {release.isUpcoming && (
            <span
              className="shrink-0 text-[9px] font-mono uppercase tracking-wider text-teal bg-teal/10 border border-teal/30 rounded px-1.5 py-0.5"
              data-testid={`badge-upcoming-${release.id}`}
            >
              Upcoming
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {release.artist}
          {release.albumType && (
            <>
              <span className="mx-1.5">·</span>
              <span className="uppercase tracking-wider font-mono text-[9px]">
                {release.albumType}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground tabular shrink-0">
        {formatRelease(release.releaseDate)}
      </div>
      {release.url && (
        <ExternalLink
          size={11}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />
      )}
    </a>
  );
}

function ReleaseListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="w-11 h-11 rounded bg-secondary/50 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 bg-secondary/50 rounded animate-pulse" />
            <div className="h-2 w-1/3 bg-secondary/40 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function UnauthorizedHint() {
  return (
    <div
      className="rounded-lg border border-border bg-card/40 px-5 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      data-testid="text-music-unauth"
    >
      <div>
        <div className="text-sm font-medium">Connect Spotify to see your music.</div>
        <div className="text-xs text-muted-foreground mt-0.5">Read-only. We pull recent plays, new releases, and the genres you live in.</div>
      </div>
      <a
        href="/api/auth/spotify/login"
        className="inline-flex items-center justify-center gap-2 rounded-md bg-teal text-background hover:bg-teal/90 transition-colors px-4 py-2 text-xs font-mono uppercase tracking-wider shrink-0"
        data-testid="button-connect-spotify-music"
      >
        <Plug size={12} />
        Connect Spotify
      </a>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Page                                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

export default function Music() {
  const qc = useQueryClient();
  const { mode, withMode } = useMode();

  const recentGenre = useQuery<GenreResp>({
    queryKey: ["/api/music-recs", "recent-genre", mode],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/music-recs?section=recent-genre`))).json(),
  });
  const rotationGenre = useQuery<GenreResp>({
    queryKey: ["/api/music-recs", "rotation-genre", mode],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/music-recs?section=rotation-genre`))).json(),
  });
  const releases = useQuery<ReleasesResp>({
    queryKey: ["/api/music-recs", "upcoming-releases", mode],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/music-recs?section=upcoming-releases`))).json(),
  });
  const mood = useQuery<MoodResp>({
    queryKey: ["/api/music-mood", mode],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/music-mood`))).json(),
    // Mood is server-cached for 6h; refetching client-side every minute is wasteful.
    staleTime: 5 * 60 * 1000,
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/music-recs"] });
    qc.invalidateQueries({ queryKey: ["/api/music-mood"] });
  };

  const isAnyUnauthorized =
    recentGenre.data?.source === "unauthorized" ||
    rotationGenre.data?.source === "unauthorized" ||
    releases.data?.source === "unauthorized" ||
    mood.data?.source === "unauthorized";

  const isFetching =
    recentGenre.isFetching ||
    rotationGenre.isFetching ||
    releases.isFetching ||
    mood.isFetching;

  return (
    <div className="space-y-12 animate-fade-in">
      {/* Header */}
      <section>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow mb-3">Music</div>
            <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight">
              Your taste, in one place.
            </h1>
            <p className="mt-3 text-sm text-muted-foreground max-w-xl leading-relaxed">
              New drops, the genres you live in, and a running read on your mood.
            </p>
            <div className="mt-4">
              <TopPickPill domain="artist" />
            </div>
          </div>
          <button
            type="button"
            data-testid="button-music-refresh"
            onClick={refreshAll}
            className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded border border-border"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </section>

      {isAnyUnauthorized && <UnauthorizedHint />}

      {/* Listening identity hero — replaces the old mood ticker at top */}
      <section data-testid="section-mood">
        <ListeningIdentity data={mood.data} isLoading={mood.isLoading} />
      </section>

      {/* New releases — full width row, more breathing room than before */}
      <section data-testid="section-new-releases">
        <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
              <CalendarClock size={10} className="inline mr-1 -mt-px" />
              From artists you follow
            </div>
            <h2 className="font-display text-lg leading-tight mt-1">New releases</h2>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground tabular shrink-0">
            {releases.data?.tracks?.length ?? 0} · last 90 days
          </span>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-1.5">
          {releases.isLoading ? (
            <ReleaseListSkeleton />
          ) : (releases.data?.tracks ?? []).length === 0 ? (
            <EmptyHint message="Nothing new from your followed artists in the last 90 days." />
          ) : (
            <div className="space-y-0.5 grid grid-cols-1 md:grid-cols-2 gap-x-2">
              {releases.data!.tracks!.map((r) => (
                <ReleaseRow key={r.id} release={r} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Genres — what you live in */}
      <section>
        <div className="mb-4 px-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Last played
          </div>
          <h2 className="font-display text-lg leading-tight mt-1">Recent genres</h2>
        </div>
        {recentGenre.isLoading ? (
          <GenreGridSkeleton />
        ) : (recentGenre.data?.genres ?? []).length === 0 ? (
          <EmptyHint message="No recent listening data yet. Play some tracks on Spotify and check back." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentGenre.data!.genres!.map((b) => (
              <GenreCard key={`recent-${b.genre}`} bucket={b} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 px-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            On rotation · last 4 weeks
          </div>
          <h2 className="font-display text-lg leading-tight mt-1">What's been on heavy</h2>
        </div>
        {rotationGenre.isLoading ? (
          <GenreGridSkeleton />
        ) : (rotationGenre.data?.genres ?? []).length === 0 ? (
          <EmptyHint message="Not enough listening history yet for rotation stats." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rotationGenre.data!.genres!.map((b) => (
              <GenreCard key={`rotation-${b.genre}`} bucket={b} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
