import { MapPin, Compass, Route, Calendar, Sparkles, ExternalLink, ChevronLeft, ChevronRight, Plus, X, Trash2, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TopPickPill } from "@/components/TopPickPill";
import { useState, useMemo, useEffect, useRef } from "react";
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
import Flights from "@/pages/Flights";

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

// Native visited-places (replaces the old Atlas-fetched "path" concept —
// same shape PathsMap.tsx already expects, logged directly in LifeOS
// instead of pulled from the sibling Atlas app).
type VisitedPath = {
  id: string;
  type: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  visitedDate: string | null;
  note: string | null;
};
type VisitedPlacesResp = {
  source: "native";
  paths: VisitedPath[];
};

interface CityHit {
  name: string;
  region: string;
  country: string;
  cc: string;
  lat?: number;
  lon?: number;
}

/**
 * apiRequest() (see @/lib/queryClient) already throws for any non-2xx
 * response before returning, using the raw response text — not parsed
 * JSON — in the message (`${status}: ${bodyText}`). On top of that, if
 * a route isn't registered at all and the app's SPA fallback serves
 * index.html for any unmatched path with a 200 status instead of a
 * real 404, apiRequest won't throw and a bare res.json() call blows up
 * with a raw "Unexpected token '<'" SyntaxError. This turns either
 * case into an actionable message instead of a silent or cryptic one —
 * same helper pattern as HouseholdScopePill.tsx's describeInviteError.
 */
function describePlaceError(e: any): string {
  const raw = String(e?.message ?? "");
  if (/<!doctype/i.test(raw) || /^\s*</.test(raw) || /unexpected token/i.test(raw)) {
    return "The visited-places endpoint isn't returning JSON — registerVisitedPlaceRoutes(app) is likely missing from server/routes.ts (the request is falling through to the app's HTML shell instead of hitting a real handler). See INTEGRATION.md.";
  }
  const colonIdx = raw.indexOf(": ");
  const status = colonIdx > -1 ? raw.slice(0, colonIdx) : "";
  const bodyText = colonIdx > -1 ? raw.slice(colonIdx + 2) : raw;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed?.message) return parsed.message;
  } catch {}
  if (status === "404") {
    return "Visited-places endpoint not found (404). registerVisitedPlaceRoutes(app) is likely missing from server/routes.ts — see INTEGRATION.md.";
  }
  return bodyText || raw || "Couldn't save that — try again.";
}

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
    .replace(/\s*\([^)]*\)/g, "") // drop parentheticals
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

function formatDate(iso?: string | null) {
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

  // Visited places — logged natively in LifeOS (was: fetched from the
  // sibling Atlas app via OAuth connect). Same map, same filter/pagination
  // UI in the same spot on the page — just a different data source.
  const pathsQuery = useQuery<VisitedPlacesResp>({
    queryKey: ["/api/visited-places"],
    queryFn: async () => (await apiRequest("GET", "/api/visited-places")).json(),
  });
  const visitedPaths = pathsQuery.data?.paths ?? [];

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
        <div className="mt-4">
          <TopPickPill domain="place" />
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
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <Sparkles size={13} className={`${s.pinned ? "text-teal" : "text-gold"} shrink-0 mt-[3px]`} />
                    <div className="min-w-0">
                      <div className="font-display text-lg leading-tight break-words">{s.name}</div>
                      {s.pinned && (
                        <span className="inline-block mt-1 text-[10px] font-mono uppercase tracking-[0.15em] text-teal bg-teal/10 border border-teal/20 rounded px-1.5 py-0.5" data-testid={`badge-pinned-${slugify(s.name)}`}>pinned</span>
                      )}
                    </div>
                  </div>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-[2px]"
                      data-testid={`link-sight-${slugify(s.name)}`}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.note}</p>
                <div className="mt-3">
                  <RecFeedback kind="place" externalId={`sight:${city}:${s.name}`} reason={s.note} title={`${s.name} — ${city}`} meta={{ city, kind: "sight", url: s.url }} compact />
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
                  <RecFeedback kind="place" externalId={`hood:${city}:${n.name}`} reason={n.note} title={`${n.name} — ${city}`} meta={{ city, kind: "neighborhood" }} compact />
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
                <div className="flex items-start gap-2 mb-2">
                  <Route size={13} className="text-primary shrink-0 mt-[3px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-display text-lg leading-tight break-words flex-1">{t.name}</div>
                      {t.distance && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 mt-[3px] whitespace-nowrap">
                          {t.distance}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{t.note}</p>
                <div className="mt-3">
                  <RecFeedback kind="place" externalId={`trip:${city}:${t.name}`} reason={t.note} title={`${t.name} — day trip from ${city}`} meta={{ city, kind: "daytrip" }} compact />
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
                  {e.venue && <span className="truncate max-w-[min(180px,50vw)]">{e.venue}</span>}
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

      {/* Visited places — logged natively in LifeOS */}
      <VisitedPlacesSection paths={visitedPaths} isLoading={pathsQuery.isLoading} loadError={pathsQuery.error} />
    </div>
  );
}

/* ============ Places wrapper with Food + Flights tabs ============ */
type PlacesTab = "places" | "food" | "flights";
const PLACES_TABS = [
  { id: "places" as const, label: "Places" },
  { id: "food" as const, label: "Food" },
  { id: "flights" as const, label: "Flights" },
];

export default function Places() {
  const [tab, setTab] = useTabParam<PlacesTab>("places");
  const active: PlacesTab = tab === "food" ? "food" : tab === "flights" ? "flights" : "places";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="eyebrow">Places</div>
        <PillTabs tabs={PLACES_TABS} value={active} onChange={setTab} testIdPrefix="tab-places" />
      </div>
      {active === "places" && <PlacesMain />}
      {active === "food" && <Food />}
      {active === "flights" && <Flights />}
    </div>
  );
}

/* ============ Visited places — map + log form + filter + pagination ============ */
// Replaces the old Atlas-backed section. Same map component, same
// filter-chip/pagination pattern, same spot on the page — the only
// thing that changed is where the data comes from (LifeOS's own
// visited_places table instead of the sibling Atlas app) and that
// logging now happens inline here instead of over on Atlas.
const PAGE_SIZE = 12;
const PLACE_TYPES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "national_park", label: "National Parks" },
  { id: "state", label: "States" },
  { id: "country", label: "Countries" },
  { id: "stadium", label: "Stadiums" },
  { id: "concert", label: "Concerts" },
  { id: "beach", label: "Beaches" },
];
const LOGGABLE_TYPES = ["national_park", "state", "country", "stadium", "concert", "beach"] as const;

function VisitedPlacesSection({
  paths,
  isLoading,
  loadError,
}: {
  paths: VisitedPath[];
  isLoading: boolean;
  loadError?: unknown;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  // ── add-place form state ──────────────────────────────────────────────
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("national_park");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [hits, setHits] = useState<CityHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [visitedDate, setVisitedDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = locationQuery.trim();
    if (term.length < 2) { setHits([]); return; }
    const mySeq = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiRequest("GET", `/api/places/city-search?q=${encodeURIComponent(term)}`);
        const d: { items?: CityHit[] } = await res.json();
        if (mySeq !== seq.current) return;
        setHits(Array.isArray(d.items) ? d.items : []);
      } catch {
        if (mySeq === seq.current) setHits([]);
      } finally {
        if (mySeq === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [locationQuery]);

  const pickHit = (h: CityHit) => {
    setLocationLabel(`${h.name}${h.region ? `, ${h.region}` : ""}`);
    setLocationQuery("");
    setHits([]);
    setLat(h.lat ?? null);
    setLon(h.lon ?? null);
  };

  const resetForm = () => {
    setName(""); setType("national_park"); setLocationQuery(""); setLocationLabel("");
    setLat(null); setLon(null); setVisitedDate(""); setNote(""); setFormError(null); setAdding(false);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/visited-places"] });

  const save = async () => {
    if (!name.trim()) { setFormError("Give it a name — e.g. \"Yellowstone National Park.\""); return; }
    if (!locationLabel) { setFormError("Search for a location and pick one from the list."); return; }
    setSaving(true);
    setFormError(null);
    try {
      await apiRequest("POST", "/api/visited-places", {
        type, name: name.trim(), location: locationLabel,
        latitude: lat, longitude: lon,
        visitedDate: visitedDate || undefined,
        note: note.trim() || undefined,
      });
      invalidate();
      resetForm();
    } catch (e: any) {
      setFormError(describePlaceError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await apiRequest("DELETE", `/api/visited-places/${id}`);
    invalidate();
  };

  // Available filters = only those with data (plus "All")
  const availableFilters = useMemo(() => {
    const present = new Set(paths.map((p) => p.type));
    return PLACE_TYPES.filter((f) => f.id === "all" || present.has(f.id));
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

  if (isLoading) {
    return (
      <section>
        <SectionHeader eyebrow="Paths" title="Places you've been" />
        <div className="rounded-lg border border-border bg-card/40 h-[360px] animate-pulse mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card/40 p-5 h-32 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <SectionHeader
          eyebrow="Paths"
          title="Places you've been"
          description={
            paths.length > 0
              ? `${paths.length} place${paths.length === 1 ? "" : "s"} logged across ${Object.keys(counts).length - 1} categories.`
              : "Log a national park, a stadium, a concert — anywhere you've actually been."
          }
        />
        <button
          type="button"
          data-testid="button-log-place"
          onClick={() => setAdding(o => !o)}
          className="h-8 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 hover:bg-accent px-3 transition-colors font-mono text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
        >
          {adding ? <X size={12} /> : <Plus size={12} />}
          {adding ? "Cancel" : "Log a place"}
        </button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card/60 p-4 mb-6 space-y-2.5 max-w-md" data-testid="form-log-place">
          <div className="flex flex-wrap gap-1.5">
            {LOGGABLE_TYPES.map(t => (
              <button
                key={t}
                type="button"
                data-testid={`button-place-type-${t}`}
                onClick={() => setType(t)}
                className="text-[11px] rounded-full border px-2.5 py-1 transition"
                style={
                  type === t
                    ? { borderColor: typeColor(t), backgroundColor: `${typeColor(t)}22`, color: typeColor(t) }
                    : undefined
                }
              >
                {typeLabel(t)}
              </button>
            ))}
          </div>

          <input
            data-testid="input-place-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name — e.g. Yellowstone National Park"
            className="w-full h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal"
          />

          <div className="relative">
            {locationLabel ? (
              <div className="flex items-center justify-between gap-2 h-8 text-sm rounded-md border border-border bg-background px-2.5">
                <span className="truncate">{locationLabel}</span>
                <button
                  type="button"
                  data-testid="button-clear-place-location"
                  onClick={() => { setLocationLabel(""); setLat(null); setLon(null); }}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <input
                  data-testid="input-place-location"
                  value={locationQuery}
                  onChange={e => setLocationQuery(e.target.value)}
                  placeholder="Search a city or place…"
                  className="w-full h-8 text-sm rounded-md border border-border bg-background pl-2.5 pr-7 focus:outline-none focus:ring-1 focus:ring-teal"
                />
                {searching && (
                  <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                )}
                {hits.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-border bg-popover divide-y divide-border/40 absolute w-full z-10">
                    {hits.map((h, i) => (
                      <li key={`${h.name}-${h.region}-${i}`}>
                        <button
                          type="button"
                          data-testid={`option-place-location-${i}`}
                          onClick={() => pickHit(h)}
                          className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-accent/50 transition"
                        >
                          {h.name}{h.region ? `, ${h.region}` : ""}{" "}
                          <span className="text-muted-foreground/70">{h.cc || h.country}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <input
            data-testid="input-place-date"
            type="date"
            value={visitedDate}
            onChange={e => setVisitedDate(e.target.value)}
            className="w-full h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <input
            data-testid="input-place-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal"
          />

          {formError && <div className="text-[11px] text-rose">{formError}</div>}
          <button
            type="button"
            data-testid="button-save-place"
            onClick={save}
            disabled={saving}
            className="w-full rounded-md bg-blue text-white text-xs font-medium py-1.5 hover:opacity-90 transition disabled:opacity-60"
          >
            {saving ? "Saving…" : "Log this place"}
          </button>
          <div className="text-[10px] text-muted-foreground italic">
            Coordinates come from the location search, so pins land near the city center — close enough for the map,
            not exact for a specific venue.
          </div>
        </div>
      )}

      {paths.length === 0 ? (
        loadError ? (
          <div className="rounded-lg border border-rose/30 bg-rose/5 px-5 py-6 text-center" data-testid="error-visited-places">
            <Route size={20} className="mx-auto text-rose/70 mb-2" />
            <div className="text-sm text-rose">Couldn't load your visited places.</div>
            <div className="text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
              {describePlaceError(loadError)}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/20 px-5 py-8 text-center" data-testid="empty-visited-places">
            <Route size={20} className="mx-auto text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground">No places logged yet.</div>
            <div className="text-xs text-muted-foreground/70 mt-1">Use "Log a place" above to add the first one.</div>
          </div>
        )
      ) : (
        <>
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
                data-testid={`card-visited-place-${p.id}`}
              >
                <div className="flex items-start justify-between mb-3 gap-3">
                  <span
                    className="eyebrow uppercase tracking-wider"
                    style={{ color: typeColor(p.type) }}
                  >
                    {typeLabel(p.type)}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.visitedDate && (
                      <span className="font-mono text-[10px] tabular text-muted-foreground">
                        {formatDate(p.visitedDate)}
                      </span>
                    )}
                    <button
                      type="button"
                      data-testid={`button-delete-visited-place-${p.id}`}
                      onClick={() => remove(p.id)}
                      aria-label={`Remove ${p.name}`}
                      className="text-muted-foreground hover:text-rose transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="font-display text-xl leading-tight">{p.name}</div>
                  {p.location && (
                    <div className="font-mono text-[11px] text-muted-foreground mt-1 truncate">
                      {p.location}
                    </div>
                  )}
                </div>
                {p.note && (
                  <p className="mt-4 text-sm text-muted-foreground leading-relaxed line-clamp-3">{p.note}</p>
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
        </>
      )}
    </section>
  );
}
