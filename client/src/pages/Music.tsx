import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Music as MusicIcon } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { apiRequest } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";

interface Track {
  id: string;
  name: string;
  artist: string;
  album?: string;
  image?: string;
  playedAt?: string;
  releaseDate?: string;
  albumType?: string;
  url?: string;
  pinned?: boolean;
}

interface MusicResp {
  source: string;
  tracks: Track[];
  asOf?: string;
  reason?: string;
}

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
  // Spotify returns "YYYY-MM-DD" or "YYYY"
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function TrackRow({ t }: { t: Track }) {
  return (
    <a
      href={t.url}
      target={t.url ? "_blank" : undefined}
      rel="noreferrer"
      data-testid={`row-track-${t.id}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-accent/30 transition-colors group"
    >
      {t.image ? (
        <img src={t.image} alt="" className="w-12 h-12 rounded shrink-0 object-cover" />
      ) : (
        <div className="w-12 h-12 rounded shrink-0 bg-secondary/50 grid place-items-center text-muted-foreground">
          <MusicIcon size={16} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-display text-sm leading-tight truncate">{t.name}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {t.artist}{t.album ? ` · ${t.album}` : ""}
        </div>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground tabular shrink-0">
        {t.playedAt ? timeAgo(t.playedAt) : formatRelease(t.releaseDate)}
      </div>
      {t.url && (
        <ExternalLink size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </a>
  );
}

function EmptyState({ source }: { source: string }) {
  if (source === "unauthorized") {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm text-muted-foreground" data-testid="text-music-unauth">
        Connect Spotify to see real listening data. (Auth via the profile menu.)
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card/40 px-5 py-4 text-sm text-muted-foreground">
      Nothing surfaced yet. Listen to some tracks on Spotify and check back.
    </div>
  );
}

export default function Music() {
  const qc = useQueryClient();
  const { mode, withMode } = useMode();

  const recent = useQuery<MusicResp>({
    queryKey: ["/api/music-recs", "recent", mode],
    queryFn: async () => (await apiRequest("GET", withMode(`/api/music-recs?section=recent`))).json(),
  });
  const top = useQuery<MusicResp>({
    queryKey: ["/api/music-recs", "top", mode],
    queryFn: async () => (await apiRequest("GET", withMode(`/api/music-recs?section=top`))).json(),
  });
  const newRel = useQuery<MusicResp>({
    queryKey: ["/api/music-recs", "new", mode],
    queryFn: async () => (await apiRequest("GET", withMode(`/api/music-recs?section=new`))).json(),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/music-recs"] });
  };

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow mb-3">Music</div>
            <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight">
              What you've been listening to, and what's new from the artists you follow.
            </h1>
          </div>
          <button
            type="button"
            data-testid="button-music-refresh"
            onClick={refreshAll}
            className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded border border-border"
          >
            <RefreshCw size={12} className={recent.isFetching || top.isFetching || newRel.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </section>

      {/* Recently played */}
      <section>
        <SectionHeader
          eyebrow="Recently played"
          title="Your last 20 tracks"
          description={recent.data?.asOf ? `source · ${recent.data.source} · ${timeAgo(recent.data.asOf)}` : "Live from Spotify."}
        />
        {recent.isLoading ? (
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="w-12 h-12 rounded bg-secondary/50 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 bg-secondary/50 rounded animate-pulse" />
                  <div className="h-2 w-1/2 bg-secondary/40 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (recent.data?.tracks ?? []).length === 0 ? (
          <EmptyState source={recent.data?.source ?? "none"} />
        ) : (
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {recent.data!.tracks.map(t => <TrackRow key={t.id} t={t} />)}
          </div>
        )}
      </section>

      {/* Top tracks */}
      <section>
        <SectionHeader
          eyebrow="Top tracks"
          title="On rotation, last 4 weeks"
          description={top.data?.asOf ? `source · ${top.data.source}` : "Spotify short-term top."}
        />
        {top.isLoading ? (
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="w-12 h-12 rounded bg-secondary/50 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 bg-secondary/50 rounded animate-pulse" />
                  <div className="h-2 w-1/2 bg-secondary/40 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (top.data?.tracks ?? []).length === 0 ? (
          <EmptyState source={top.data?.source ?? "none"} />
        ) : (
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {top.data!.tracks.map(t => <TrackRow key={t.id} t={t} />)}
          </div>
        )}
      </section>

      {/* New releases from followed artists */}
      <section>
        <SectionHeader
          eyebrow="New releases"
          title="From artists you follow"
          description="Albums and singles released in the last 60 days, sorted by date."
        />
        {newRel.isLoading ? (
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="w-12 h-12 rounded bg-secondary/50 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 bg-secondary/50 rounded animate-pulse" />
                  <div className="h-2 w-1/2 bg-secondary/40 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (newRel.data?.tracks ?? []).length === 0 ? (
          <EmptyState source={newRel.data?.source ?? "none"} />
        ) : (
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {newRel.data!.tracks.map(t => <TrackRow key={t.id} t={t} />)}
          </div>
        )}
      </section>
    </div>
  );
}
