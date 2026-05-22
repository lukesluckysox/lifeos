import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Plus, X, ExternalLink, Utensils, Globe, Sparkles, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";
import { useLocation as useCity } from "@/components/LocationProvider";
import { RecFeedback } from "@/components/RecFeedback";
import { useToast } from "@/hooks/use-toast";

interface FoodResultBase { id?: number; name: string; city: string; category?: string; note?: string; url?: string; source: "curated" | "osm" | "manual"; }
interface FoodResp { city: string; query: string; count: number; results: FoodResultBase[]; }
interface OsmResp { city: string; results: FoodResultBase[]; error?: string; }

type SourceFilter = "all" | "curated" | "osm" | "manual";

export default function Food() {
  const { mode, withMode } = useMode();
  const { city } = useCity();
  const { toast } = useToast();

  const [q, setQ] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", note: "", url: "" });
  const [osmLoading, setOsmLoading] = useState(false);

  const { data, isLoading } = useQuery<FoodResp>({
    queryKey: ["/api/food-spots", mode, city, q, source],
    queryFn: async () => {
      const url = `/api/food-spots?city=${encodeURIComponent(city)}` +
        (q ? `&q=${encodeURIComponent(q)}` : "") +
        (source !== "all" ? `&source=${source}` : "");
      return (await apiRequest("GET", withMode(url))).json();
    },
  });

  const addSpot = useMutation({
    mutationFn: async (body: any) => (await apiRequest("POST", "/api/food-spots", body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/food-spots"] });
      toast({ title: "Saved", description: "Added to your spots." });
      setForm({ name: "", category: "", note: "", url: "" });
      setShowAdd(false);
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const removeSpot = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/food-spots/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/food-spots"] }),
  });

  async function pullOsm() {
    setOsmLoading(true);
    try {
      const r = await apiRequest("GET", `/api/food-spots/osm?city=${encodeURIComponent(city)}`);
      const j: OsmResp = await r.json();
      if (j.results?.length) {
        // Save first 10 as a quick import to manual table with source=osm
        const slice = j.results.slice(0, 10);
        await Promise.all(slice.map(s => apiRequest("POST", "/api/food-spots", { ...s, source: "osm" })));
        queryClient.invalidateQueries({ queryKey: ["/api/food-spots"] });
        toast({ title: "OSM import", description: `Pulled ${slice.length} spots near ${city}.` });
      } else {
        toast({ title: "OSM", description: "No results returned.", variant: "destructive" });
      }
    } finally {
      setOsmLoading(false);
    }
  }

  const results = data?.results ?? [];

  return (
    <div className="space-y-10 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Food {mode === "demo" && <span className="ml-2 text-gold">· demo</span>}</div>
        <h1 className="font-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight tracking-tight max-w-2xl">
          Neighborhood <span className="text-teal italic">spots</span>.
        </h1>
        <p className="text-sm text-muted-foreground mt-3 max-w-xl">
          Curated picks, mapped from OpenStreetMap, and your own saved places — searchable as one list.
        </p>
      </section>

      {/* Controls */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="input-food-search"
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name, cuisine, note…"
            className="w-full pl-9 pr-3 h-9 text-sm rounded-md bg-secondary/40 border border-border focus:outline-none focus:ring-1 focus:ring-teal"
          />
        </div>
        <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-secondary/40 text-xs font-mono uppercase tracking-wider text-muted-foreground" data-testid="text-food-city">
          <span className="text-teal">●</span> {city}
        </span>
        <div className="flex gap-1 rounded-md border border-border p-0.5 bg-secondary/40">
          {(["all", "curated", "osm", "manual"] as SourceFilter[]).map(s => (
            <button
              key={s}
              data-testid={`button-source-${s}`}
              onClick={() => setSource(s)}
              className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded transition-colors ${source === s ? "bg-teal text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={pullOsm}
          disabled={osmLoading}
          data-testid="button-osm-import"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-xs font-mono text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-50"
        >
          <Globe size={12} /> {osmLoading ? "Pulling…" : "Import OSM"}
        </button>
        <button
          onClick={() => setShowAdd(s => !s)}
          data-testid="button-add-food"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-teal text-background text-xs font-mono hover:bg-teal/90 transition-colors"
        >
          <Plus size={12} /> Add spot
        </button>
      </section>

      {/* Add form */}
      {showAdd && (
        <section className="rounded-lg border border-border bg-card p-5 max-w-xl" data-testid="form-add-food">
          <div className="eyebrow mb-3">New spot</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="h-9 px-3 text-sm rounded-md bg-background border border-border" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-food-name" />
            <input className="h-9 px-3 text-sm rounded-md bg-background border border-border" placeholder="Cuisine / category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} data-testid="input-food-category" />
            <input className="h-9 px-3 text-sm rounded-md bg-background border border-border sm:col-span-2" placeholder="Note (one liner)" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} data-testid="input-food-note" />
            <input className="h-9 px-3 text-sm rounded-md bg-background border border-border sm:col-span-2" placeholder="URL (optional)" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} data-testid="input-food-url" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => {
                if (!form.name) return toast({ title: "Name required", variant: "destructive" });
                addSpot.mutate({ ...form, city, source: "manual" });
              }}
              disabled={addSpot.isPending}
              data-testid="button-save-food"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-teal text-background text-xs font-mono"
            >
              Save
            </button>
            <button onClick={() => setShowAdd(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Results */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <div className="eyebrow">
            {isLoading ? "Loading…" : `${results.length} spot${results.length === 1 ? "" : "s"} in ${city}`}
          </div>
          {q && <button onClick={() => setQ("")} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><X size={11} />clear search</button>}
        </div>
        {results.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/40 px-6 py-10 text-center">
            <div className="font-display text-lg">No spots yet.</div>
            <div className="text-sm text-muted-foreground mt-2">Try changing the city, importing from OpenStreetMap, or adding one manually.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map((r, i) => {
              const key = r.id != null ? `db-${r.id}` : `${r.source}-${r.name}-${i}`;
              return (
                <div key={key} data-testid={`card-food-${key}`} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2 hover:border-teal/40 transition-colors">
                  <div className="flex items-start gap-2">
                    <Utensils size={14} className="text-teal mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-base leading-tight truncate" title={r.name}>{r.name}</div>
                      {r.category && (
                        <div className="text-xs text-muted-foreground mt-0.5">{r.category}</div>
                      )}
                    </div>
                    <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                      r.source === "curated" ? "bg-gold/10 text-gold border border-gold/30" :
                      r.source === "osm" ? "bg-blue-500/10 text-blue-500 border border-blue-500/30" :
                      "bg-teal/10 text-teal border border-teal/30"
                    }`}>
                      {r.source}
                    </span>
                  </div>
                  {r.note && (
                    <div className="text-xs text-foreground/80 leading-relaxed">{r.note}</div>
                  )}
                  <div className="mt-auto pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                    <RecFeedback
                      kind="food"
                      externalId={`${r.source}-${r.name}-${r.city}`}
                      why={r.source === "curated" ? "Hand-picked local classic" : r.source === "osm" ? "Nearby on OpenStreetMap" : "You saved this"}
                      title={`${r.name} \u2014 ${r.city}`}
                      meta={{ city: r.city, source: r.source, url: r.url, note: r.note }}
                      compact
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open link">
                          <ExternalLink size={12} />
                        </a>
                      )}
                      {r.id != null && r.source !== "curated" && (
                        <button
                          onClick={() => removeSpot.mutate(r.id!)}
                          className="text-muted-foreground hover:text-rose"
                          aria-label="Remove"
                          data-testid={`button-remove-food-${r.id}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
