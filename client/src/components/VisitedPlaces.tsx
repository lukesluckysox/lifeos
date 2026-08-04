import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Plus, X, MapPin, Trash2, Loader2 } from "lucide-react";
import { PathsMap, typeColor, typeLabel, type MapPath } from "./PathsMap";

interface VisitedPlace extends MapPath {
  visitedDate?: string | null;
  note?: string | null;
}
interface VisitedPlacesResp {
  source: string;
  paths: VisitedPlace[];
}

const KNOWN_TYPES = ["national_park", "state", "country", "stadium", "concert", "beach"] as const;

interface CityHit {
  name: string;
  region: string;
  country: string;
  cc: string;
  lat?: number;
  lon?: number;
}

/**
 * Native "places you've been" logging — replaces the Atlas/Trace OAuth
 * connect flow for this one page. Same PathsMap.tsx rendering, just fed
 * from LifeOS's own visited_places table instead of a cross-app fetch.
 *
 * Location search reuses the same /api/places/city-search endpoint
 * AppShell's city picker already calls — no new geocoding dependency,
 * no API key. It resolves to city-level coordinates, which is close
 * enough for a map pin; for a specific venue (a stadium, a park
 * entrance) the coordinates will be approximate to the city center
 * unless you enter latitude/longitude by hand in the advanced fields.
 *
 * Drop <VisitedPlaces /> into Places.tsx in place of (or alongside,
 * during transition) whatever currently renders the Atlas-backed map.
 */
export function VisitedPlaces() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
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
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const { data } = useQuery<VisitedPlacesResp>({
    queryKey: ["/api/visited-places"],
    queryFn: async () => (await apiRequest("GET", "/api/visited-places")).json(),
  });
  const places = data?.paths ?? [];

  // Debounced city search — same 250ms pattern as AppShell's CitySearch.
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
    setName("");
    setType("national_park");
    setLocationQuery("");
    setLocationLabel("");
    setLat(null);
    setLon(null);
    setVisitedDate("");
    setNote("");
    setError(null);
    setAdding(false);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/visited-places"] });

  const save = async () => {
    if (!name.trim()) { setError("Give it a name — e.g. \"Yellowstone National Park.\""); return; }
    if (!locationLabel) { setError("Search for a location and pick one from the list."); return; }
    setSaving(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/visited-places", {
        type, name: name.trim(), location: locationLabel,
        latitude: lat, longitude: lon,
        visitedDate: visitedDate || undefined,
        note: note.trim() || undefined,
      });
      invalidate();
      resetForm();
    } catch {
      setError("Couldn't save that — try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await apiRequest("DELETE", `/api/visited-places/${id}`);
    invalidate();
  };

  return (
    <section className="space-y-4" data-testid="section-visited-places">
      <PathsMap paths={places} />

      <div className="rounded-xl border border-border bg-card/40 p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <MapPin size={13} className="text-blue" />
            <h2 className="font-display text-base">Places you've been</h2>
          </div>
          <button
            type="button"
            data-testid="button-add-visited-place"
            onClick={() => setAdding(o => !o)}
            className="h-8 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 hover:bg-accent px-3 transition-colors font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            {adding ? <X size={12} /> : <Plus size={12} />}
            {adding ? "Cancel" : "Log a place"}
          </button>
        </div>

        {adding && (
          <div className="rounded-lg border border-border/60 bg-background/40 p-3 mb-4 space-y-2.5" data-testid="form-add-visited-place">
            <div className="flex flex-wrap gap-1.5">
              {KNOWN_TYPES.map(t => (
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
                  <span className={type === t ? "" : "border-border text-muted-foreground"}>
                    {typeLabel(t)}
                  </span>
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

            <div className="flex gap-2">
              <input
                data-testid="input-place-date"
                type="date"
                value={visitedDate}
                onChange={e => setVisitedDate(e.target.value)}
                className="flex-1 h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal"
              />
            </div>
            <input
              data-testid="input-place-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="w-full h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal"
            />

            {error && <div className="text-[11px] text-rose">{error}</div>}
            <button
              type="button"
              data-testid="button-save-visited-place"
              onClick={save}
              disabled={saving}
              className="w-full rounded-md bg-blue text-white text-xs font-medium py-1.5 hover:opacity-90 transition disabled:opacity-60"
            >
              {saving ? "Saving…" : "Log this place"}
            </button>
            <div className="text-[10px] text-muted-foreground italic">
              Coordinates come from the city search, so pins land near the city center — close enough for the map,
              not exact for a specific venue.
            </div>
          </div>
        )}

        {places.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">
            Nothing logged yet — add the first place you've been.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {places.map(p => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 text-sm rounded-md border border-border/60 px-3 py-2"
                data-testid={`item-visited-place-${p.id}`}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: typeColor(p.type) }}
                  />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {typeLabel(p.type)}{p.location ? ` · ${p.location}` : ""}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`button-delete-place-${p.id}`}
                  onClick={() => remove(p.id)}
                  aria-label={`Remove ${p.name}`}
                  className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-rose hover:bg-rose/10 transition-colors shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
