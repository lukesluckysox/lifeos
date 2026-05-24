import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AddItem } from "@/components/AddItem";
import { Search as SearchIcon, Tv, Film as FilmIcon, Sparkles, Heart, ThumbsUp, X, RefreshCw, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { RatingBar } from "@/components/RatingBar";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { apiRequest } from "@/lib/queryClient";
import { useRatings, useSetRating, useRemoveRating, type Rating } from "@/hooks/useRatings";
import { scoreCatalog } from "@/data/score";
import { PillTabs } from "@/components/PillTabs";
import { useTabParam } from "@/hooks/useTabParam";
import { TopPickPill } from "@/components/TopPickPill";

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

interface UserItem {
  id: number;
  kind: "show" | "film";
  title: string;
  subtitle?: string | null;
  url?: string | null;
  meta?: Record<string, any> | null;
  createdAt: number;
}

/** Normalize titles for matching across data sources. */
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ============ Shared seed section (Catalog only) ============ */
function SeedYourTaste({ liked, ratings }: { liked: Rating[]; ratings: Rating[] | undefined }) {
  const [seedQuery, setSeedQuery] = useState("");
  const [seedDebounced, setSeedDebounced] = useState("");
  const setRating = useSetRating();

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

  const seedSuggestions = (seedResults?.items ?? []).slice(0, 6);

  return (
    <section className="rounded-lg border border-border bg-card/50 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <div className="eyebrow text-teal mb-1">Seed your taste</div>
          <div className="font-display text-lg leading-tight">Add titles you love to bootstrap recommendations</div>
          <p className="text-xs text-muted-foreground mt-1 max-w-lg">Type a show or film you've enjoyed, then tap to add it. Each entry sharpens what we surface in Shows and Movies. Can't find it in the catalog? Use "add manually" below.</p>
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
  );
}

/* ============ Library card (saved items on Catalog tab) ============ */
function LibraryCard({
  kind,
  title,
  year,
  posterPath,
  signalLabel,
  signalColor,
  onRemove,
  testId,
}: {
  kind: "show" | "film";
  title: string;
  year?: number | null;
  posterPath?: string | null;
  signalLabel: string;
  signalColor: string;
  onRemove: () => void;
  testId: string;
}) {
  return (
    <div data-testid={testId} className="rounded-lg border border-border bg-card p-4 flex gap-3">
      {posterPath ? (
        <img src={posterPath} alt={title} className="w-14 h-20 object-cover rounded shrink-0" />
      ) : (
        <div className="w-14 h-20 rounded shrink-0 bg-secondary/50 grid place-items-center text-muted-foreground">
          {kind === "show" ? <Tv size={16} /> : <FilmIcon size={16} />}
        </div>
      )}
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="eyebrow mb-1">{kind} {year ? `· ${year}` : ""}</div>
        <div className="font-display text-base leading-tight line-clamp-2">{title}</div>
        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <span className={`font-mono text-[10px] uppercase tracking-wider ${signalColor}`}>{signalLabel}</span>
          <button
            type="button"
            data-testid={`${testId}-remove`}
            onClick={onRemove}
            aria-label="Remove from library"
            className="h-7 w-7 grid place-items-center rounded border border-border text-muted-foreground hover:text-rose hover:border-rose/40 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Catalog tab — saved library only ============ */
function WatchLibrary() {
  const qc = useQueryClient();
  const { data: ratings } = useRatings();
  const removeRating = useRemoveRating();

  const { data: userShows } = useQuery<UserItem[]>({
    queryKey: ["/api/user-items", "show"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user-items?kind=show");
      return res.json();
    },
  });
  const { data: userFilms } = useQuery<UserItem[]>({
    queryKey: ["/api/user-items", "film"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user-items?kind=film");
      return res.json();
    },
  });

  const watchRatings = useMemo(
    () => (ratings ?? []).filter(r => r.kind === "show" || r.kind === "film"),
    [ratings]
  );
  const liked = useMemo(() => watchRatings.filter(r => r.signal >= 1), [watchRatings]);
  const watchlist = useMemo(() => watchRatings.filter(r => r.signal === 0), [watchRatings]);
  const disliked = useMemo(() => watchRatings.filter(r => r.signal === -1), [watchRatings]);

  function signalMeta(signal: number) {
    if (signal === 2) return { label: "loved", color: "text-gold" };
    if (signal === 1) return { label: "liked", color: "text-teal" };
    if (signal === 0) return { label: "watchlist", color: "text-gold" };
    return { label: "skipped", color: "text-rose" };
  }

  // Render order: Loved/Liked → Watchlist → Manually added → Skipped
  const ratedSorted = useMemo(
    () => [...watchRatings].sort((a, b) => {
      const order = (s: number) => (s === 2 ? 0 : s === 1 ? 1 : s === 0 ? 2 : 4);
      return order(a.signal) - order(b.signal);
    }),
    [watchRatings]
  );

  // Filter out user_items already represented in ratings (match by normalized title)
  const ratedTitleSet = useMemo(
    () => new Set(watchRatings.map(r => `${r.kind}:${normTitle(r.title)}`)),
    [watchRatings]
  );
  const manualOnly = useMemo(() => {
    const all: UserItem[] = [...(userShows ?? []), ...(userFilms ?? [])];
    return all.filter(it => !ratedTitleSet.has(`${it.kind}:${normTitle(it.title)}`));
  }, [userShows, userFilms, ratedTitleSet]);

  const totalLibrary = ratedSorted.length + manualOnly.length;

  async function removeUserItem(id: number) {
    await apiRequest("DELETE", `/api/user-items/${id}`);
    qc.invalidateQueries({ queryKey: ["/api/user-items"] });
  }

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Watch · Catalog</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          Your library — everything you've rated or saved.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground max-w-xl leading-relaxed">
          Discoveries you've engaged with live here. Head over to Shows or Movies to find what's next.
        </p>
      </section>

      <SeedYourTaste liked={liked} ratings={ratings} />

      {/* Library snapshot */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border">
        <LibCard label="Loved & liked" value={liked.length} icon={Sparkles} accent="text-teal" />
        <LibCard label="Watchlist" value={watchlist.length} icon={Tv} accent="text-gold" />
        <LibCard label="Skipped" value={disliked.length} icon={FilmIcon} accent="text-rose" />
      </section>

      {totalLibrary === 0 && (
        <section className="rounded-lg border border-dashed border-border bg-card/30 p-8 text-center">
          <div className="eyebrow mb-2">Empty library</div>
          <div className="font-display text-lg leading-tight">Nothing rated yet</div>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Seed your taste above, or head to Shows / Movies and rate something to start building your library.
          </p>
        </section>
      )}

      {ratedSorted.length > 0 && (
        <section>
          <SectionHeader eyebrow="Rated" title="What you've rated" description="From discovery — likes, watchlist, and skips." />
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ratedSorted.map(r => {
              const { label, color } = signalMeta(r.signal);
              const meta = r.meta || {};
              return (
                <LibraryCard
                  key={`r-${r.id}`}
                  kind={r.kind as "show" | "film"}
                  title={r.title}
                  year={meta.year}
                  posterPath={meta.posterPath}
                  signalLabel={label}
                  signalColor={color}
                  onRemove={() => removeRating.mutate({ kind: r.kind as any, externalId: r.externalId })}
                  testId={`card-library-rating-${r.id}`}
                />
              );
            })}
          </div>
        </section>
      )}

      {manualOnly.length > 0 && (
        <section>
          <SectionHeader eyebrow="Manually added" title="Titles you added by hand" />
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {manualOnly.map(it => (
              <LibraryCard
                key={`u-${it.id}`}
                kind={it.kind}
                title={it.title}
                year={(it.meta as any)?.year}
                posterPath={(it.meta as any)?.posterPath}
                signalLabel="added"
                signalColor="text-muted-foreground"
                onRemove={() => removeUserItem(it.id)}
                testId={`card-library-useritem-${it.id}`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ============ Shows / Movies tabs — discovery only ============ */
function WatchDiscovery({ kindFilter }: { kindFilter: "show" | "film" }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [restPage, setRestPage] = useState(0);

  const { data, isLoading } = useQuery<{ source: string; items: CatalogItem[] }>({
    queryKey: ["/api/catalog", query, kindFilter],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (query) p.set("q", query);
      p.set("kind", kindFilter);
      const res = await apiRequest("GET", `/api/catalog${p.toString() ? "?" + p : ""}`);
      return res.json();
    },
  });

  const { data: ratings } = useRatings();
  const { data: userShows } = useQuery<UserItem[]>({
    queryKey: ["/api/user-items", "show"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user-items?kind=show");
      return res.json();
    },
    enabled: kindFilter === "show",
  });
  const { data: userFilms } = useQuery<UserItem[]>({
    queryKey: ["/api/user-items", "film"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user-items?kind=film");
      return res.json();
    },
    enabled: kindFilter === "film",
  });

  const liked = useMemo(
    () => (ratings ?? []).filter(r => (r.kind === "show" || r.kind === "film") && r.signal >= 1),
    [ratings]
  );
  const disliked = useMemo(
    () => (ratings ?? []).filter(r => (r.kind === "show" || r.kind === "film") && r.signal === -1),
    [ratings]
  );

  // Build exclusion set: anything user has saved/rated/added of this kind
  const excludedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of (ratings ?? [])) {
      if (r.kind === kindFilter) s.add(String(r.externalId));
    }
    return s;
  }, [ratings, kindFilter]);

  const excludedTitles = useMemo(() => {
    const s = new Set<string>();
    for (const r of (ratings ?? [])) {
      if (r.kind === kindFilter) s.add(normTitle(r.title));
    }
    const ui = kindFilter === "show" ? (userShows ?? []) : (userFilms ?? []);
    for (const it of ui) s.add(normTitle(it.title));
    return s;
  }, [ratings, userShows, userFilms, kindFilter]);

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
    // Filter out anything already in the user's library
    const filtered = items.filter(it =>
      !excludedIds.has(String(it.id)) &&
      !excludedTitles.has(normTitle(it.title))
    );
    return filtered
      .map(it => scoreCatalog(it, { likedThemes, likedGenres, dislikedTitles, ratedIds, currentYear: 2026 }))
      .sort((a, b) => b.total - a.total);
  }, [data, liked, disliked, ratings, excludedIds, excludedTitles]);

  const top = scored.slice(0, 6);
  const allRest = scored.slice(6);
  const PER_PAGE = 6;
  const restPageCount = Math.max(1, Math.ceil(allRest.length / PER_PAGE));

  useEffect(() => {
    if (restPage >= restPageCount) setRestPage(0);
  }, [restPageCount, restPage]);

  const rest = allRest.slice(restPage * PER_PAGE, (restPage + 1) * PER_PAGE);
  const kindLabel = kindFilter === "show" ? "Shows" : "Movies";

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Watch · {kindLabel}</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          Discover {kindFilter === "show" ? "shows" : "films"} you haven't seen yet.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground max-w-xl leading-relaxed">
          Anything already in your Catalog is hidden. Rate to push the next pick — affinity, adjacency, recency, novelty all feed the score.
        </p>
      </section>

      {/* Search */}
      <section className="space-y-4">
        <div className="relative">
          <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid={`input-search-${kindFilter}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kindFilter === "show" ? "shows" : "films"}…`}
            className="w-full h-10 pl-9 pr-3 rounded-md bg-secondary/40 border border-border text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal"
          />
        </div>
        <div className="eyebrow flex items-center gap-3">
          <span>source · {data?.source ?? "—"}</span>
          <span>·</span>
          <span>{scored.length} discoveries</span>
          {isLoading && <span className="text-teal">loading…</span>}
        </div>
      </section>

      {/* Top recs */}
      <section>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <SectionHeader
            eyebrow="Recommended"
            title={`Best ${kindFilter === "show" ? "shows" : "films"} for you`}
            description="Filtered to titles you haven't engaged with. Tap 'show why' on any card to see the weighted components."
          />
          <button
            type="button"
            data-testid={`button-${kindFilter}-refresh`}
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
              Nothing new to show. Try a different search, or clear something from your Catalog.
            </div>
          )}
        </div>
      </section>

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

/* ============ Watch wrapper: Catalog | Shows | Movies ============ */
type WatchTab = "catalog" | "show" | "movie";
const WATCH_TABS = [
  { id: "catalog" as const, label: "Catalog" },
  { id: "show" as const, label: "Shows" },
  { id: "movie" as const, label: "Movies" },
];

export default function Watch() {
  const [tab, setTab] = useTabParam<WatchTab>("catalog");
  const active: WatchTab =
    tab === "show" || tab === "movie" ? tab : "catalog";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="eyebrow">Watch</div>
        <PillTabs tabs={WATCH_TABS} value={active} onChange={setTab} testIdPrefix="tab-watch" />
      </div>

      {active === "show" && (
        <div data-testid="section-top-show">
          <TopPickPill domain="show" />
        </div>
      )}
      {active === "movie" && (
        <div data-testid="section-top-movie">
          <TopPickPill domain="movie" />
        </div>
      )}

      {active === "catalog" && <WatchLibrary />}
      {active === "show" && <WatchDiscovery kindFilter="show" />}
      {active === "movie" && <WatchDiscovery kindFilter="film" />}
    </div>
  );
}
