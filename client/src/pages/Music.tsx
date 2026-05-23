import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Music as MusicIcon, Disc3, CalendarClock, Plug } from "lucide-react";
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

interface FollowedArtist {
  id: string;
  name: string;
  url?: string;
  image?: string;
  genres: string[];
  primaryGenre?: string;
}

interface FollowedResp {
  source: string;
  artists?: FollowedArtist[];
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

function FollowedArtistRow({ artist }: { artist: FollowedArtist }) {
  return (
    <a
      href={artist.url}
      target={artist.url ? "_blank" : undefined}
      rel="noreferrer"
      data-testid={`row-followed-${artist.id}`}
      className="flex items-center gap-3 px-3 py-2 hover:bg-accent/30 transition-colors group rounded"
    >
      {artist.image ? (
        <img src={artist.image} alt="" className="w-9 h-9 rounded-full shrink-0 object-cover" />
      ) : (
        <div className="w-9 h-9 rounded-full shrink-0 bg-secondary/50 grid place-items-center">
          <MusicIcon size={12} className="text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-display text-sm leading-tight truncate">{artist.name}</div>
        {artist.primaryGenre && (
          <div className="text-[10px] text-muted-foreground truncate mt-0.5 uppercase tracking-wider font-mono">
            {artist.primaryGenre}
          </div>
        )}
      </div>
      {artist.url && (
        <ExternalLink
          size={11}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />
      )}
    </a>
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
    </a>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="w-9 h-9 rounded-full bg-secondary/50 animate-pulse" />
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
        <div className="text-xs text-muted-foreground mt-0.5">Read-only. We pull your followed artists, recent plays, and new releases.</div>
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
  const followed = useQuery<FollowedResp>({
    queryKey: ["/api/music-recs", "followed-artists", mode],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/music-recs?section=followed-artists`))).json(),
  });
  const upcoming = useQuery<ReleasesResp>({
    queryKey: ["/api/music-recs", "upcoming-releases", mode],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/music-recs?section=upcoming-releases`))).json(),
  });

  const refreshAll = () => qc.invalidateQueries({ queryKey: ["/api/music-recs"] });

  const isAnyUnauthorized =
    recentGenre.data?.source === "unauthorized" ||
    rotationGenre.data?.source === "unauthorized" ||
    followed.data?.source === "unauthorized" ||
    upcoming.data?.source === "unauthorized";

  const isFetching =
    recentGenre.isFetching ||
    rotationGenre.isFetching ||
    followed.isFetching ||
    upcoming.isFetching;

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
              Your followed artists, what just dropped, and the genres in your rotation.
            </p>
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

      {/* Top row: Followed artists (left) | Upcoming releases (right) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Followed artists */}
        <div data-testid="section-followed-artists">
          <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                Artists you follow
              </div>
              <h2 className="font-display text-lg leading-tight mt-1">Your library</h2>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground tabular shrink-0">
              {followed.data?.artists?.length ?? 0} artists
            </span>
          </div>
          <div className="rounded-lg border border-border bg-card/40 p-1.5 max-h-[420px] overflow-y-auto">
            {followed.isLoading ? (
              <SidebarSkeleton />
            ) : (followed.data?.artists ?? []).length === 0 ? (
              <EmptyHint message="No followed artists yet. Follow some on Spotify and refresh." />
            ) : (
              <div className="space-y-0.5">
                {followed.data!.artists!.map((a) => (
                  <FollowedArtistRow key={a.id} artist={a} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* New releases (past 90 days + any pre-saves) */}
        <div data-testid="section-new-releases">
          <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                <CalendarClock size={10} className="inline mr-1 -mt-px" />
                From artists you follow
              </div>
              <h2 className="font-display text-lg leading-tight mt-1">New releases</h2>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground tabular shrink-0">
              last 90 days
            </span>
          </div>
          <div className="rounded-lg border border-border bg-card/40 p-1.5 max-h-[420px] overflow-y-auto">
            {upcoming.isLoading ? (
              <SidebarSkeleton />
            ) : (upcoming.data?.tracks ?? []).length === 0 ? (
              <EmptyHint message="Nothing new from your followed artists in the last 90 days." />
            ) : (
              <div className="space-y-0.5">
                {upcoming.data!.tracks!.map((r) => (
                  <ReleaseRow key={r.id} release={r} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Bottom row: genre rollups */}
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
