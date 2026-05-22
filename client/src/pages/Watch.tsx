import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AddItem } from "@/components/AddItem";
import { Search as SearchIcon, Tv, Film as FilmIcon, Sparkles, Heart, ThumbsUp, X, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { RatingBar } from "@/components/RatingBar";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { apiRequest } from "@/lib/queryClient";
import { useRatings, useSetRating } from "@/hooks/useRatings";
import { scoreCatalog } from "@/data/score";
import { PillTabs } from "@/components/PillTabs";
import { useTabParam } from "@/hooks/useTabParam";
import Film from "@/pages/Film";

interface CatalogItem {
  id: string;
  kind: "show" | "film";
  title: string;
  year: number;
  overview: string;
  posterPath?: string;
  voteAverage: number;
  genres: string[];
  themes: string[];
  pinned?: boolean;
  userItemId?: number;
}

type Filter = "all" | "show" | "film";

function WatchCatalog() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [seedQuery, setSeedQuery] = useState("");
  const [seedDebounced, setSeedDebounced] = useState("");
  // Pagination for "rest of the catalog" — 6 per page (2 rows × 3)
  const [restPage, setRestPage] = useState(0);

  // Debounce the seed search so we don't hit /api/catalog on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setSeedDebounced(seedQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [seedQuery]);

  const { data: seedResults } = useQuery<{ items: CatalogItem[] }>({
    queryKey: ["/api/catalog", "seed", seedDebounced],
    queryFn: async () => {
      if (!seedDebounced) return { items: [] };
      const res = await apiRequest("GET", `/api/catalog?q=${encodeURIComponent(seedDebounced)}`);
      return res.json();
    },
    enabled: seedDebounced.length >= 2,
  });
  const setRating = useSetRating();

  const { data, isLoading } = useQuery<{ source: string; items: CatalogItem[] }>({
    queryKey: ["/api/catalog", query, filter],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (query) p.set("q", query);
      if (filter !== "all") p.set("kind", filter);
      const res = await apiRequest("GET", `/api/catalog${p.toString() ? "?" + p : ""}`);
      return res.json();
    },
  });

  const { data: ratings } = useRatings();

  const liked = useMemo(() => (ratings ?? []).filter(r => (r.kind === "show" || r.kind === "film") && r.signal >= 1), [ratings]);
  const disliked = useMemo(() => (ratings ?? []).filter(r => (r.kind === "show" || r.kind === "film") && r.signal === -1), [ratings]);
  const watchlist = useMemo(() => (ratings ?? []).filter(r => (r.kind === "show" || r.kind === "film") && r.signal === 0), [ratings]);

  const scored = useMemo(() => {
    const items = data?.items ?? [];
    const likedThemes = new Set<string>();
    const likedGenres = new Set<string>();
    for (const r of liked) {
      const meta = r.meta || {};
      (meta.themes || []).forEach((t: string) => likedThemes.add(t));
      (meta.genres || []).forEach((g: string) => likedGenres.add(g));
    }
    const dislikedTitles = new Set(disliked.map(d => d.title.toLowerCase()));
    const ratedIds = new Set((ratings ?? []).map(r => r.externalId));
    return items
      .map(it => scoreCatalog(it, { likedThemes, likedGenres, dislikedTitles, ratedIds, currentYear: 2026 }))
      .sort((a, b) => b.total - a.total);
  }, [data, liked, disliked, ratings]);

  const top = scored.slice(0, 6);
  const allRest = scored.slice(6);
  const PER_PAGE = 6;
  const restPageCount = Math.max(1, Math.ceil(allRest.length / PER_PAGE));

  // Clamp the page index if the underlying catalog shrinks
  useEffect(() => {
    if (restPage >= restPageCount) setRestPage(0);
  }, [restPageCount, restPage]);

  const rest = allRest.slice(restPage * PER_PAGE, (restPage + 1) * PER_PAGE);

  const seedSuggestions = (seedResults?.items ?? []).slice(0, 6);

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Watch</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          Rate what you've seen. Every signal pushes the next recommendation.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground max-w-xl leading-relaxed">
          Likes and dislikes feed a transparent score — affinity, adjacency, recency, novelty — for every title we surface.
        </p>
      </section>

      {/* ============ Seed your taste ============ */}
      <section className="rounded-lg border border-border bg-card/50 p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div>
            <div className="eyebrow text-teal mb-1">Seed your taste</div>
            <div className="font-display text-lg leading-tight">Add titles you love to bootstrap recommendations</div>
            <p className="text-xs text-muted-foreground mt-1 max-w-lg">Type a show or film you've enjoyed, then tap to add it. Each entry sharpens what we surface below. Can't find it in the catalog? Use “add manually” below.</p>
          </div>
          <div className="hidden sm:block text-right">
            <div className="eyebrow">Seeded</div>
            <div className="font-display text-2xl tabular">{liked.length}</div>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <AddItem
            kind="show"
            label="Add show manually"
            titlePlaceholder="Show title"
            subtitlePlaceholder="Note (optional)"
            size="compact"
          />
          <AddItem
            kind="film"
            label="Add film manually"
            titlePlaceholder="Film title"
            subtitlePlaceholder="Note (optional)"
            size="compact"
          />
        </div>
        <div className="relative">
          <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="input-seed-taste"
            value={seedQuery}
            onChange={(e) => setSeedQuery(e.target.value)}
            placeholder="e.g. The Wire, Severance, Tinker Tailor Soldier Spy…"
            className="w-full h-11 pl-9 pr-9 rounded-md bg-background border border-border text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal"
          />
          {seedQuery && (
            <button
              onClick={() => setSeedQuery("")}
              aria-label="Clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {seedDebounced.length >= 2 && (
          <div className="mt-3 space-y-1.5">
            {seedSuggestions.length === 0 && (
              <div className="text-xs text-muted-foreground py-2">No matches — try a different title.</div>
            )}
            {seedSuggestions.map(s => {
              const alreadyRated = (ratings ?? []).some(r => r.kind === s.kind && r.externalId === s.id);
              return (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/40 transition-colors">
                  {s.posterPath ? (
                    <img src={s.posterPath} alt={s.title} className="w-8 h-12 object-cover rounded shrink-0" />
                  ) : (
                    <div className="w-8 h-12 rounded shrink-0 bg-secondary/50 grid place-items-center text-muted-foreground">
                      {s.kind === "show" ? <Tv size={12} /> : <FilmIcon size={12} />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium truncate">{s.title}</div>
                      {s.pinned && (
                        <span data-testid={`badge-pinned-${s.id}`} className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-teal border border-teal/40 rounded px-1 py-0.5">pinned</span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{s.kind} · {s.year || "—"}</div>
                  </div>
                  {alreadyRated ? (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-teal">added</span>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        data-testid={`button-seed-like-${s.id}`}
                        onClick={() => setRating.mutate({ kind: s.kind, externalId: s.id, title: s.title, signal: 1, meta: { year: s.year, genres: s.genres, themes: s.themes, posterPath: s.posterPath } })}
                        title="Add as Liked"
                        className="h-8 w-8 grid place-items-center rounded-md border border-border hover:border-teal hover:text-teal transition-colors"
                      >
                        <ThumbsUp size={13} />
                      </button>
                      <button
                        data-testid={`button-seed-love-${s.id}`}
                        onClick={() => setRating.mutate({ kind: s.kind, externalId: s.id, title: s.title, signal: 2, meta: { year: s.year, genres: s.genres, themes: s.themes, posterPath: s.posterPath } })}
                        title="Add as Loved"
                        className="h-8 w-8 grid place-items-center rounded-md border border-border hover:border-gold hover:text-gold transition-colors"
                      >
                        <Heart size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Search + filter */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              data-testid="input-search-catalog"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shows and films…"
              className="w-full h-10 pl-9 pr-3 rounded-md bg-secondary/40 border border-border text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal"
            />
          </div>
          <div className="flex gap-1 p-1 rounded-md bg-secondary/40 border border-border">
            {(["all", "show", "film"] as Filter[]).map(f => (
              <button
                key={f}
                data-testid={`button-filter-${f}`}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded transition-colors ${
                  filter === f ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "show" ? "shows" : f === "film" ? "films" : "all"}
              </button>
            ))}
          </div>
        </div>
        <div className="eyebrow flex items-center gap-3">
          <span>source · {data?.source ?? "—"}</span>
          <span>·</span>
          <span>{data?.items?.length ?? 0} results</span>
          {isLoading && <span className="text-teal">loading…</span>}
        </div>
      </section>

      {/* Your library snapshot */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border">
        <LibCard label="Loved & liked" value={liked.length} icon={Sparkles} accent="text-teal" />
        <LibCard label="Watchlist" value={watchlist.length} icon={Tv} accent="text-gold" />
        <LibCard label="Skipped" value={disliked.length} icon={FilmIcon} accent="text-rose" />
      </section>

      {/* Top recs */}
      <section>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <SectionHeader
            eyebrow="Recommended"
            title="Best matches against your library"
            description="Sorted by score. Tap 'show why' on any card to see the weighted components."
          />
          <button
            type="button"
            data-testid="button-best-matches-refresh"
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/catalog"] })}
            className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded border border-border shrink-0"
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {top.map(({ item, total, components, reasons }) => (
            <CatalogCard key={item.id} item={item} total={total} components={components} reasons={reasons} />
          ))}
          {top.length === 0 && !isLoading && (
            <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
              No results. Try a different search.
            </div>
          )}
        </div>
      </section>

      {/* Rest — paginated 6 at a time */}
      {allRest.length > 0 && (
        <section>
          <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
            <SectionHeader eyebrow="More" title="The rest of the catalog" />
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-[11px] text-muted-foreground tabular" data-testid="text-rest-page">
                {restPage + 1} / {restPageCount}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  data-testid="button-rest-prev"
                  onClick={() => setRestPage(p => Math.max(0, p - 1))}
                  disabled={restPage === 0}
                  aria-label="Previous page"
                  className="h-8 w-8 grid place-items-center rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  data-testid="button-rest-next"
                  onClick={() => setRestPage(p => Math.min(restPageCount - 1, p + 1))}
                  disabled={restPage >= restPageCount - 1}
                  aria-label="Next page"
                  className="h-8 w-8 grid place-items-center rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rest.map(({ item, total, components, reasons }) => (
              <CatalogCard key={item.id} item={item} total={total} components={components} reasons={reasons} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LibCard({ label, value, icon: Icon, accent }: any) {
  return (
    <div className="bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="eyebrow">{label}</span>
        <Icon size={13} strokeWidth={1.5} className={accent} />
      </div>
      <div className="font-display text-2xl tabular">{value}</div>
    </div>
  );
}

function CatalogCard({ item, total, components, reasons }: any) {
  return (
    <div className={`rounded-lg border bg-card p-5 flex flex-col ${item.pinned ? "border-teal/40" : "border-border"}`}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <div className="eyebrow mb-1 flex items-center gap-2">
            <span>{item.kind} · {item.year}</span>
            {item.pinned && (
              <span data-testid={`badge-pinned-${item.id}`} className="font-mono text-[9px] uppercase tracking-wider text-teal border border-teal/40 rounded px-1 py-0.5 normal-case">pinned</span>
            )}
          </div>
          <div className="font-display text-lg leading-tight line-clamp-2">{item.title}</div>
        </div>
        {item.posterPath ? (
          <img src={item.posterPath} alt={item.title} className="w-14 h-20 object-cover rounded shrink-0" />
        ) : (
          <div className="w-14 h-20 rounded shrink-0 bg-secondary/50 grid place-items-center text-muted-foreground">
            {item.kind === "show" ? <Tv size={16} /> : <FilmIcon size={16} />}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 min-h-[3rem]">{item.overview}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {item.genres.slice(0, 3).map((g: string) => (
          <span key={g} className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border rounded px-1.5 py-0.5">{g}</span>
        ))}
      </div>

      <ScoreBreakdown total={total} components={components} reasons={reasons} />

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground tabular">★ {(item.voteAverage ?? 0).toFixed(1)}</span>
        <RatingBar kind={item.kind} externalId={item.id} title={item.title} meta={{ year: item.year, genres: item.genres, themes: item.themes, posterPath: item.posterPath }} />
      </div>
    </div>
  );
}

/* ============ Watch wrapper with Film tab ============ */
type WatchTab = "catalog" | "film";
const WATCH_TABS = [
  { id: "catalog" as const, label: "Catalog" },
  { id: "film" as const, label: "Film" },
];

export default function Watch() {
  const [tab, setTab] = useTabParam<WatchTab>("catalog");
  const active: WatchTab = tab === "film" ? "film" : "catalog";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="eyebrow">Watch</div>
        <PillTabs tabs={WATCH_TABS} value={active} onChange={setTab} testIdPrefix="tab-watch" />
      </div>
      {active === "catalog" ? <WatchCatalog /> : <Film />}
    </div>
  );
}
