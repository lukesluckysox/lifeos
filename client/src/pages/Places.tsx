import { Plus, MapPin } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { entities, relations } from "@/data/graph";
import { placeRecs } from "@/data/recs";

const CLUSTER_LABELS: Record<string, string> = {
  "surf": "Surf breaks",
  "scenic-drive": "Scenic drives",
  "city": "Cities",
  "restaurant": "Restaurants",
  "hike": "Hikes",
  "neighborhood": "Neighborhoods",
};

export default function Places() {
  const visited = new Set(
    relations.filter((r) => r.from === "user" && r.kind === "visited").map((r) => r.to),
  );

  const places = entities.filter((e) => e.kind === "place" && visited.has(e.id));
  const clusters = new Map<string, typeof places>();
  for (const p of places) {
    const c = String(p.meta?.cluster ?? "other");
    if (!clusters.has(c)) clusters.set(c, []);
    clusters.get(c)!.push(p);
  }
  const recs = placeRecs();

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Places</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          A memory map. Grouped by likeness, not by latitude.
        </h1>
      </section>

      {/* Clusters as a vertical tree */}
      <section>
        <SectionHeader eyebrow="Memory clusters" title="Places, grouped by feel" />
        <div className="space-y-8">
          {Array.from(clusters.entries()).map(([cluster, list]) => (
            <div key={cluster}>
              <div className="flex items-baseline gap-3 mb-3">
                <div className="font-display text-lg">{CLUSTER_LABELS[cluster] ?? cluster}</div>
                <div className="font-mono text-[11px] text-muted-foreground tabular">
                  {list.length} {list.length === 1 ? "place" : "places"}
                </div>
              </div>
              <div className="relative pl-6 border-l border-border">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border bg-card p-4 relative">
                      <div className="absolute -left-[1.625rem] top-5 h-px w-4 bg-border" />
                      <div className="absolute -left-[1.825rem] top-[1.1rem] h-1.5 w-1.5 rounded-full bg-gold" />
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-display text-base leading-tight">{p.name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                            {String(p.meta?.region ?? "")}
                          </div>
                        </div>
                        <MapPin size={13} className="text-muted-foreground shrink-0" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <button data-testid="button-add-place" className="mt-6 w-full rounded-lg border border-dashed border-border bg-card/20 px-5 py-4 text-sm text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors flex items-center justify-center gap-2">
          <Plus size={14} /> Log a place
        </button>
      </section>

      {/* Recommendations */}
      <section>
        <SectionHeader
          eyebrow="Worth a trip"
          title="Spots that fit your pattern"
          description="Unvisited places in clusters you keep returning to."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recs.map((r, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between mb-3">
                <span className="eyebrow text-gold">{CLUSTER_LABELS[String(r.entity.meta?.cluster ?? "")] ?? r.entity.meta?.cluster}</span>
                <span className="font-mono text-[10px] tabular text-gold">{Math.round(r.weight * 100)}%</span>
              </div>
              <div className="font-display text-xl leading-tight">{r.entity.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground mt-1">
                {String(r.entity.meta?.region ?? "")}
              </div>
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{r.reason}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
