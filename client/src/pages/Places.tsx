import { MapPin, Compass, Route, Calendar, Sparkles, ExternalLink, Moon, Thermometer, ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PathsMap, typeColor, typeLabel } from "@/components/PathsMap";
import { SectionHeader } from "@/components/SectionHeader";
import { AddItem } from "@/components/AddItem";
import { RecFeedback } from "@/components/RecFeedback";
import { LearningHint } from "@/components/LearningHint";
import { apiRequest } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";
import { useLocation as useCity } from "@/components/LocationProvider";
import { PillTabs } from "@/components/PillTabs";
import { useTabParam } from "@/hooks/useTabParam";
import Food from "@/pages/Food";

type Sight = { name: string; note: string; url?: string; pinned?: boolean; userItemId?: number };
type Neighborhood = { name: string; note: string };
type DayTrip = { name: string; note: string; distance?: string };
type TravelGuide = {
  city: string;
  sights: Sight[];
  neighborhoods: Neighborhood[];
  dayTrips: DayTrip[];
  curated: boolean;
};

type PlaceEvent = {
  name: string;
  venue?: string;
  city?: string;
  date?: string;
  category?: string;
  url?: string;
};
type PlacesEvents = { source: "ticketmaster" | "none"; city: string; events: PlaceEvent[]; learning?: { dropped?: number; boosted?: number; basis?: string[] | number } };

type PinnedPlace = {
  id: number;
  kind: string;
  title: string;
  subtitle: string | null;
  url: string | null;
  meta: string | null;
  createdAt: number;
};

type AtlasPath = {
  id: string;
  type: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  date: string | null;
  note: string | null;
  photoUrl: string | null;
  weatherTemp: number | null;
  weatherLabel: string | null;
  moonPhase: number | null;
  shareSlug: string | null;
  atlasShareUrl: string | null;
  createdAt: string;
};
type PathsResp = {
  paths: AtlasPath[];
  source: "atlas" | "cache" | "unconfigured" | "error";
  configured: boolean;
  atlasBaseUrl: string | null;
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Collapse duplicate happenings by their "primary" name — strips ages/parens/tour
 * decorators so 'Marlon Wayans' and 'Marlon Wayans (18+)' read as one event.
 * Keeps the earliest-dated row and bumps a moreDates counter on the rest.
 */
function primaryEventName(name: string) {
  return (name || "")
    .replace(/\s*\([^)]*\)/g, "")            // drop parentheticals
    .replace(/\s*-\s*(Ages?|18\+|21\+|All Ages).*$/i, "") // drop age tails
    .replace(/\s+(Tour|Touring|Live)\s*$/i, "") // drop tour labels
    .trim()
    .toLowerCase();
}

function dedupeByPrimaryName<T extends { name: string; date?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  // sort by date asc first so we keep the soonest row
  const sorted = [...items].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  for (const e of sorted) {
    const k = primaryEventName(e.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function formatDate(iso?: string) {
  if (!iso) return "TBA";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function PlacesMain() {
  const { mode, withMode } = useMode();
  const { city } = useCity();

  const pinnedQuery = useQuery<PinnedPlace[]>({
    queryKey: ["/api/user-items", "place"],
    queryFn: async () => (await apiRequest("GET", "/api/user-items?kind=place")).json(),
  });
  const pinnedPlaces = pinnedQuery.data ?? [];
  // Group pinned places by subtitle (city/neighborhood). Falls back to "Other".
  const pinnedClusters = new Map<string, PinnedPlace[]>();
  for (const p of pinnedPlaces) {
    const key = (p.subtitle?.trim() || "Other").trim();
    if (!pinnedClusters.has(key)) pinnedClusters.set(key, []);
    pinnedClusters.get(key)!.push(p);
  }

  // Atlas paths — real places logged in the sibling app
  const pathsQuery = useQuery<PathsResp>({
    queryKey: ["/api/paths"],
    queryFn: async () => (await apiRequest("GET", "/api/paths")).json(),
  });
  const atlasPaths = pathsQuery.data?.paths ?? [];
  const atlasConfigured = pathsQuery.data?.configured ?? false;

  const guideQuery = useQuery<TravelGuide>({
    queryKey: ["/api/travel-guide", city],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/travel-guide?city=${encodeURIComponent(city)}`))).json(),
  });

  const eventsQuery = useQuery<PlacesEvents>({
    queryKey: ["/api/places-events", mode, city],
    queryFn: async () =>
      (await apiRequest("GET", withMode(`/api/places-events?city=${encodeURIComponent(city)}`))).json(),
  });

  const guide = guideQuery.data;
  const events = eventsQuery.data?.events ?? [];

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Places</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          A memory map. Grouped by likeness, not by latitude.
        </h1>
        <div className="mt-4 inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <MapPin size={12} />
          <span data-testid="text-places-city">{city}</span>
          {guide?.curated && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] normal-case tracking-normal">
              curated
            </span>
          )}
        </div>
      </section>

      {/* Travel — Top sights / landmarks */}
      <section>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <SectionHeader
            eyebrow="Top sights"
            title={`What to see in ${guide?.city ?? city}`}
            description="Landmarks worth working into a day."
          />
          <AddItem
            kind="place"
            label="Add place"
            titlePlaceholder="Place name"
            subtitlePlaceholder="City or neighborhood"
            showUrl
            size="compact"
            invalidateKeys={[["/api/user-items"]]}
          />
        </div>
        {guideQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/40 p-5 h-32 animate-pulse" />
            ))}
          </div>
        ) : guide && guide.sights.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guide.sights.map((s) => (
              <div
                key={s.name}
                className="rounded-lg border border-border bg-card p-5"
                data-testid={`card-sight-${slugify(s.name)}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles size={13} className={`${s.pinned ? "text-teal" : "text-gold"} shrink-0`} />
                    <div className="font-display text-lg leading-tight truncate">{s.name}</div>
                    {s.pinned && (
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-teal bg-teal/10 border border-teal/20 rounded px-1.5 py-0.5 shrink-0" data-testid={`badge-pinned-${slugify(s.name)}`}>pinned</span>
                    )}
                  </div>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`link-sight-${slugify(s.name)}`}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.note}</p>
                <div className="mt-3">
                  <RecFeedback kind="place" externalId={`sight:${city}:${s.name}`} reason={s.note} title={`${s.name} \u2014 ${city}`} meta={{ city, kind: "sight", url: s.url }} compact />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No sights available for {city} yet.</div>
        )}
      </section>

      {/* Travel — Neighborhoods to wander */}
      <section>
        <SectionHeader
          eyebrow="Neighborhoods"
          title="Where to wander"
          description="Districts to walk slowly, not drive through."
        />
        {guideQuery.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/40 p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : guide && guide.neighborhoods.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {guide.neighborhoods.map((n) => (
              <div
                key={n.name}
                className="rounded-lg border border-border bg-card p-4"
                data-testid={`card-neighborhood-${slugify(n.name)}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Compass size={13} className="text-primary shrink-0" />
                  <div className="font-display text-base leading-tight">{n.name}</div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{n.note}</p>
                <div className="mt-3">
                  <RecFeedback kind="place" externalId={`hood:${city}:${n.name}`} reason={n.note} title={`${n.name} \u2014 ${city}`} meta={{ city, kind: "neighborhood" }} compact />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No neighborhoods listed for {city}.</div>
        )}
      </section>

      {/* Travel — Day trips */}
      <section>
        <SectionHeader
          eyebrow="Day trips"
          title="Out of town, back by sunset"
          description="A short drive or train ride away."
        />
        {guideQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/40 p-5 h-28 animate-pulse" />
            ))}
          </div>
        ) : guide && guide.dayTrips.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guide.dayTrips.map((t) => (
              <div
                key={t.name}
                className="rounded-lg border border-border bg-card p-5"
                data-testid={`card-daytrip-${slugify(t.name)}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <Route size={13} className="text-primary shrink-0" />
                    <div className="font-display text-lg leading-tight">{t.name}</div>
                  </div>
                  {t.distance && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground tabular shrink-0">
                      {t.distance}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{t.note}</p>
                <div className="mt-3">
                  <RecFeedback kind="place" externalId={`trip:${city}:${t.name}`} reason={t.note} title={`${t.name} \u2014 day trip from ${city}`} meta={{ city, kind: "daytrip" }} compact />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No day trips listed for {city}.</div>
        )}
      </section>

      {/* Travel — Cultural / seasonal events */}
      <section>
        <SectionHeader
          eyebrow="What's on"
          title="Cultural & seasonal happenings"
          description="Festivals, shows, exhibits, and one-off events around the city."
        >
          <LearningHint learning={eventsQuery.data?.learning} />
        </SectionHeader>
        {eventsQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/40 p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : events.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dedupeByPrimaryName(events).slice(0, 8).map((e, i) => (
              <div
                key={`${e.name}-${i}`}
                className="rounded-lg border border-border bg-card p-4"
                data-testid={`card-event-${slugify(e.name)}-${i}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Calendar size={13} className="text-gold shrink-0" />
                    <div className="font-display text-base leading-tight truncate">{e.name}</div>
                  </div>
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      data-testid={`link-event-${slugify(e.name)}-${i}`}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="tabular">{formatDate(e.date)}</span>
                  {e.venue && <span className="truncate max-w-[180px]">{e.venue}</span>}
                  {e.category && (
                    <span className="rounded-full border border-border px-1.5 py-0.5 normal-case tracking-normal">
                      {e.category}
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <RecFeedback kind="event" externalId={`evt:${city}:${e.name}`} reason={e.category} title={e.name} meta={{ city, venue: e.venue, date: e.date, url: e.url, category: e.category }} compact />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No upcoming events surfaced for {city} right now. Try a larger city, or check back later.
          </div>
        )}
      </section>

      {/* Pinned places — real user-saved data, grouped by city / subtitle */}
      <section>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <SectionHeader
            eyebrow="Your pinned places"
            title="Places you've saved"
            description="Grouped by city. Add a place and it shows up here."
          />
          <AddItem
            kind="place"
            label="Pin a place"
            titlePlaceholder="Place name"
            subtitlePlaceholder="City or neighborhood"
            showUrl
            size="compact"
            invalidateKeys={[["/api/user-items"], ["/api/user-items", "place"]]}
          />
        </div>
        {pinnedQuery.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card/40 p-4 h-20 animate-pulse" />
            ))}
          </div>
        ) : pinnedPlaces.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/20 px-5 py-8 text-center" data-testid="empty-pinned-places">
            <MapPin size={20} className="mx-auto text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground">No pinned places yet.</div>
            <div className="text-xs text-muted-foreground/70 mt-1">Pin a place above and it'll appear here, grouped by city.</div>
          </div>
        ) : (
          <div className="space-y-8">
            {Array.from(pinnedClusters.entries()).map(([groupKey, list]) => (
              <div key={groupKey}>
                <div className="flex items-baseline gap-3 mb-3">
                  <div className="font-display text-lg" data-testid={`text-pinned-group-${slugify(groupKey)}`}>{groupKey}</div>
                  <div className="font-mono text-[11px] text-muted-foreground tabular">
                    {list.length} {list.length === 1 ? "place" : "places"}
                  </div>
                </div>
                <div className="relative pl-6 border-l border-border">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {list.map((p) => (
                      <div key={p.id} className="rounded-lg border border-border bg-card p-4 relative" data-testid={`card-pinned-place-${p.id}`}>
                        <div className="absolute -left-[1.625rem] top-5 h-px w-4 bg-border" />
                        <div className="absolute -left-[1.825rem] top-[1.1rem] h-1.5 w-1.5 rounded-full bg-gold" />
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-display text-base leading-tight truncate">{p.title}</div>
                            {p.subtitle && (
                              <div className="font-mono text-[10px] text-muted-foreground mt-1 uppercase tracking-wider truncate">
                                {p.subtitle}
                              </div>
                            )}
                          </div>
                          {p.url ? (
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors shrink-0" data-testid={`link-pinned-place-${p.id}`}>
                              <ExternalLink size={13} />
                            </a>
                          ) : (
                            <MapPin size={13} className="text-muted-foreground shrink-0" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Atlas paths — real places logged in the sibling app */}
      <AtlasPathsSection
        paths={atlasPaths}
        configured={atlasConfigured}
        isLoading={pathsQuery.isLoading}
        atlasBaseUrl={pathsQuery.data?.atlasBaseUrl}
      />
    </div>
  );
}

/* ============ Places wrapper with Food tab ============ */
type PlacesTab = "places" | "food";
const PLACES_TABS = [
  { id: "places" as const, label: "Places" },
  { id: "food" as const, label: "Food" },
];

export default function Places() {
  const [tab, setTab] = useTabParam<PlacesTab>("places");
  const active: PlacesTab = tab === "food" ? "food" : "places";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="eyebrow">Places</div>
        <PillTabs tabs={PLACES_TABS} value={active} onChange={setTab} testIdPrefix="tab-places" />
      </div>
      {active === "places" ? <PlacesMain /> : <Food />}
    </div>
  );
}

/* ============ Atlas paths — map + filter + pagination ============ */
const PAGE_SIZE = 12;
const ATLAS_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "national_park", label: "National Parks" },
  { id: "state", label: "States" },
  { id: "country", label: "Countries" },
  { id: "stadium", label: "Stadiums" },
  { id: "concert", label: "Concerts" },
  { id: "beach", label: "Beaches" },
];

function AtlasPathsSection({
  paths,
  configured,
  isLoading,
  atlasBaseUrl,
}: {
  paths: AtlasPath[];
  configured: boolean;
  isLoading: boolean;
  atlasBaseUrl: string | null | undefined;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  // Available filters = only those with data (plus "All")
  const availableFilters = useMemo(() => {
    const present = new Set(paths.map((p) => p.type));
    return ATLAS_FILTERS.filter((f) => f.id === "all" || present.has(f.id));
  }, [paths]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: paths.length };
    for (const p of paths) m[p.type] = (m[p.type] || 0) + 1;
    return m;
  }, [paths]);

  const filtered = useMemo(() => {
    if (filter === "all") return paths;
    return paths.filter((p) => p.type === filter);
  }, [paths, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // ── empty / loading states ──────────────────────────────────────────
  if (!configured && !isLoading) {
    return (
      <section>
        <SectionHeader eyebrow="Paths" title="Places you've logged in Atlas" />
        <div className="rounded-lg border border-dashed border-border bg-card/20 px-5 py-8 text-center" data-testid="empty-paths-unconfigured">
          <Route size={20} className="mx-auto text-muted-foreground mb-2" />
          <div className="text-sm text-muted-foreground">Connect Atlas to see places you've walked.</div>
          <div className="text-xs text-muted-foreground/70 mt-1 max-w-sm mx-auto">
            Atlas is the sibling app that logs the routes you actually take. Once it's linked, your real-world paths show up here.
          </div>
          <a
            href="https://traces.up.railway.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-teal hover:underline mt-4 font-mono uppercase tracking-wider"
            data-testid="link-open-atlas-empty"
          >
            Open Atlas <ExternalLink size={11} />
          </a>
        </div>
      </section>
    );
  }
  if (isLoading) {
    return (
      <section>
        <SectionHeader eyebrow="Paths" title="Places you've logged in Atlas" />
        <div className="rounded-lg border border-border bg-card/40 h-[360px] animate-pulse mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card/40 p-5 h-32 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }
  if (paths.length === 0) {
    return (
      <section>
        <SectionHeader eyebrow="Paths" title="Places you've logged in Atlas" />
        <div className="rounded-lg border border-dashed border-border bg-card/20 px-5 py-8 text-center" data-testid="empty-paths">
          <Route size={20} className="mx-auto text-muted-foreground mb-2" />
          <div className="text-sm text-muted-foreground">No paths logged in Atlas yet.</div>
          {atlasBaseUrl && (
            <a href={atlasBaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-teal hover:underline mt-3" data-testid="link-open-atlas">
              Open Atlas <ExternalLink size={11} />
            </a>
          )}
        </div>
      </section>
    );
  }

  // ── main render ─────────────────────────────────────────────────────
  return (
    <section>
      <SectionHeader
        eyebrow="Paths"
        title="Places you've logged in Atlas"
        description={`${paths.length} place${paths.length === 1 ? "" : "s"} logged across ${Object.keys(counts).length - 1} categories.`}
      />

      {/* Map */}
      <div className="mb-6">
        <PathsMap paths={filtered} />
      </div>

      {/* Filter chips */}
      <div className="mb-5 flex flex-wrap gap-2" data-testid="paths-filters">
        {availableFilters.map((f) => {
          const active = filter === f.id;
          const count = counts[f.id] || 0;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => { setFilter(f.id); setPage(0); }}
              data-testid={`filter-paths-${f.id}`}
              className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-xs font-mono uppercase tracking-wider transition-colors ${
                active
                  ? "border-teal/60 bg-teal/10 text-teal"
                  : "border-border bg-card/40 text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {f.id !== "all" && (
                <span
                  style={{ background: typeColor(f.id), width: 7, height: 7, borderRadius: 999, display: "inline-block" }}
                />
              )}
              {f.label}
              <span className={`tabular ${active ? "text-teal" : "text-muted-foreground/60"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pageItems.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-border bg-card p-5"
            data-testid={`card-atlas-path-${p.id}`}
          >
            <div className="flex items-start justify-between mb-3 gap-3">
              <span
                className="eyebrow uppercase tracking-wider"
                style={{ color: typeColor(p.type) }}
              >
                {typeLabel(p.type)}
              </span>
              {p.date && (
                <span className="font-mono text-[10px] tabular text-muted-foreground">
                  {new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-xl leading-tight">{p.name}</div>
                {p.location && (
                  <div className="font-mono text-[11px] text-muted-foreground mt-1 truncate">
                    {p.location}
                  </div>
                )}
              </div>
              {p.atlasShareUrl && (
                <a
                  href={p.atlasShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  data-testid={`link-atlas-share-${p.id}`}
                  aria-label="View on Atlas"
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
            {p.photoUrl && (
              <img
                src={p.photoUrl}
                alt={p.name}
                loading="lazy"
                className="mt-4 w-full h-40 object-cover rounded-md border border-border/60"
                data-testid={`img-atlas-path-${p.id}`}
              />
            )}
            {p.note && (
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed line-clamp-3">{p.note}</p>
            )}
            {(p.weatherLabel || p.weatherTemp != null || p.moonPhase != null) && (
              <div className="mt-4 flex items-center flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {p.weatherLabel && (
                  <span className="inline-flex items-center gap-1">
                    <Thermometer size={11} />
                    {p.weatherLabel}{p.weatherTemp != null ? ` · ${Math.round(p.weatherTemp)}°` : ""}
                  </span>
                )}
                {p.moonPhase != null && (
                  <span className="inline-flex items-center gap-1">
                    <Moon size={11} />
                    {(p.moonPhase * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between" data-testid="paths-pagination">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            data-testid="button-paths-prev"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card/40 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <div className="font-mono text-[11px] tabular text-muted-foreground" data-testid="text-paths-page">
            Page {safePage + 1} of {totalPages} <span className="text-muted-foreground/60">· {filtered.length} {filter === "all" ? "total" : "in filter"}</span>
          </div>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            data-testid="button-paths-next"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card/40 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}

      {atlasBaseUrl && (
        <div className="mt-6 text-right">
          <a
            href={atlasBaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-open-atlas-all"
          >
            See all on Atlas <ExternalLink size={11} />
          </a>
        </div>
      )}
    </section>
  );
}
