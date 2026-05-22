import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Calendar, Music as MusicIcon, Trophy, Theater, Film as FilmIcon, LocateFixed, Loader2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { RatingBar } from "@/components/RatingBar";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { apiRequest } from "@/lib/queryClient";
import { useRatings } from "@/hooks/useRatings";
import { scoreEvent } from "@/data/score";

interface SeedEvent {
  id: string;
  name: string;
  category: "Music" | "Sports" | "Arts" | "Film";
  city: string;
  venue: string;
  date: string;
  time?: string;
  url?: string;
  reason?: string;
  moreDates?: number;
}

const CATEGORIES = ["All", "Music", "Sports", "Arts", "Film"] as const;
type Cat = typeof CATEGORIES[number];

const POPULAR_CITIES = ["Honolulu", "Los Angeles", "San Francisco", "New York", "Tokyo", "Lisbon"];

export default function Events() {
  const [city, setCity] = useState("Honolulu");
  const [draft, setDraft] = useState("Honolulu");
  const [cat, setCat] = useState<Cat>("All");
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "ok" | "denied">("idle");

  // Auto-detect on mount
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          // Reverse geocode via free open-meteo style fallback; use nominatim w/ proper UA disallowed,
          // so we use BigDataCloud which allows browser CORS without keys.
          const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&localityLanguage=en`);
          const j = await r.json();
          const detectedCity = j.city || j.locality || j.principalSubdivision;
          if (detectedCity) {
            setCity(detectedCity);
            setDraft(detectedCity);
            setGeoStatus("ok");
          } else {
            setGeoStatus("denied");
          }
        } catch {
          setGeoStatus("denied");
        }
      },
      () => setGeoStatus("denied"),
      { timeout: 5000 }
    );
  }, []);

  const { data, isLoading } = useQuery<{ source: string; city: string; items: SeedEvent[] }>({
    queryKey: ["/api/events", city, cat],
    queryFn: async () => {
      const p = new URLSearchParams({ city });
      if (cat !== "All") p.set("category", cat);
      const res = await apiRequest("GET", `/api/events?${p}`);
      return res.json();
    },
  });

  const { data: ratings } = useRatings();

  const scored = useMemo(() => {
    const today = new Date();
    const likedArtists = new Set<string>();
    for (const r of ratings ?? []) {
      if (r.kind === "artist" && r.signal >= 1) likedArtists.add(r.title.toLowerCase());
    }
    // Seed common known-liked artists from your Spotify rotation
    ["stick figure", "iya terra", "the movement", "maoli", "rebelution", "odesza"].forEach((a) => likedArtists.add(a));

    const dislikedTitles = new Set((ratings ?? []).filter(r => r.signal === -1).map(r => r.title.toLowerCase()));
    const ratedIds = new Set((ratings ?? []).filter(r => r.kind === "event").map(r => r.externalId));

    return (data?.items ?? [])
      .map((e) => scoreEvent(e, { likedArtists, dislikedTitles, ratedIds, homeCity: city, today }))
      .sort((a, b) => b.total - a.total);
  }, [data, ratings, city]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCity(draft);
  };

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Events</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          Concerts, sports, and gatherings within reach — ranked against your taste.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground max-w-xl leading-relaxed">
          Search any city. Each event is scored against your liked artists, places, and recency window.
        </p>
      </section>

      {/* Location bar */}
      <section>
        <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              data-testid="input-city"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="City…"
              className="w-full h-10 pl-9 pr-3 rounded-md bg-secondary/40 border border-border text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal"
            />
          </div>
          <button
            type="submit"
            data-testid="button-search-city"
            className="h-10 px-5 rounded-md bg-foreground text-background text-xs font-mono uppercase tracking-wider hover:opacity-90 transition-opacity"
          >
            Search
          </button>
          <div className="flex items-center gap-2 px-3 h-10 rounded-md border border-border text-xs text-muted-foreground">
            {geoStatus === "locating" ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}
            <span>
              {geoStatus === "ok" && "auto-detected"}
              {geoStatus === "locating" && "locating…"}
              {geoStatus === "denied" && "manual"}
              {geoStatus === "idle" && "manual"}
            </span>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {POPULAR_CITIES.map((c) => (
            <button
              key={c}
              data-testid={`button-city-${c.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => { setCity(c); setDraft(c); }}
              className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border transition-colors ${
                city === c
                  ? "border-teal text-teal bg-secondary/40"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 p-1 rounded-md bg-secondary/40 border border-border">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                data-testid={`button-cat-${c.toLowerCase()}`}
                onClick={() => setCat(c)}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded transition-colors ${
                  cat === c ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="eyebrow flex items-center gap-3">
            <span>source · {data?.source ?? "—"}</span>
            <span>·</span>
            <span>{data?.items?.length ?? 0} events</span>
            {isLoading && <span className="text-teal">loading…</span>}
          </div>
        </div>
      </section>

      {/* Events list */}
      <section>
        <SectionHeader
          eyebrow={`In ${city}`}
          title="Ranked by match score"
          description="Score factors in your liked artists, distance from home, and how soon the event is."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scored.map(({ item, total, components, reasons }) => (
            <EventCard key={item.id} ev={item} total={total} components={components} reasons={reasons} />
          ))}
          {!isLoading && scored.length === 0 && (
            <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
              No events in {city} matching that filter. Try widening the category or a nearby city.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const CAT_ICON = { Music: MusicIcon, Sports: Trophy, Arts: Theater, Film: FilmIcon } as const;
const CAT_TINT = { Music: "text-teal", Sports: "text-gold", Arts: "text-rose", Film: "text-rose" } as const;

function EventCard({ ev, total, components, reasons }: any) {
  const Icon = CAT_ICON[ev.category as keyof typeof CAT_ICON] ?? Calendar;
  const tint = CAT_TINT[ev.category as keyof typeof CAT_TINT] ?? "text-teal";
  const d = new Date(ev.date);
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon size={13} className={tint} />
            <span className={`eyebrow ${tint}`}>{ev.category}</span>
          </div>
          <div className="font-display text-lg leading-tight">{ev.name}</div>
        </div>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Calendar size={11} /> {dateStr}{ev.time ? ` · ${ev.time}` : ""}
          {ev.moreDates ? (
            <span className="ml-1 text-[10px] font-mono uppercase tracking-[0.15em] text-teal/80">
              +{ev.moreDates} more night{ev.moreDates === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5"><MapPin size={11} /> {ev.venue} · {ev.city}</div>
      </div>

      {ev.reason && (
        <div className="mt-3 text-xs text-muted-foreground italic border-l-2 border-teal/40 pl-3">
          {ev.reason}
        </div>
      )}

      <ScoreBreakdown total={total} components={components} reasons={reasons} />

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
        {ev.url ? (
          <a
            href={ev.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`link-event-${ev.id}`}
            className="text-[11px] font-mono uppercase tracking-[0.15em] text-foreground/80 hover:text-foreground"
          >
            Tickets ↗
          </a>
        ) : (
          <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground">Track only</span>
        )}
        <RatingBar kind="event" externalId={ev.id} title={ev.name} meta={{ category: ev.category, city: ev.city, date: ev.date }} />
      </div>
    </div>
  );
}
