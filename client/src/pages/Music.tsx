import { ArrowUpRight, Plus } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { entities, relations } from "@/data/graph";
import { musicRecs } from "@/data/recs";

export default function Music() {
  const likedArtists = relations
    .filter((r) => r.from === "user" && r.kind === "likes")
    .map((r) => entities.find((e) => e.id === r.to))
    .filter((e): e is NonNullable<typeof e> => !!e && e.kind === "artist");

  const adjacent = entities.filter((e) => e.kind === "artist" && !likedArtists.some((l) => l.id === e.id));
  const recs = musicRecs();

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Music</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight">
          The artists you've kept on rotation, and what they're doing next.
        </h1>
      </section>

      {/* Favorite artists */}
      <section>
        <SectionHeader eyebrow="Your favorites" title="On rotation" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {likedArtists.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-card p-4">
              <div className="font-display text-base leading-tight">{a.name}</div>
              <div className="font-mono text-[10px] text-muted-foreground mt-1.5 uppercase tracking-wider">
                {String(a.meta?.genre ?? "")}
              </div>
            </div>
          ))}
          <button data-testid="button-add-artist" className="rounded-lg border border-dashed border-border bg-card/30 p-4 text-left hover:border-teal/40 transition-colors">
            <Plus size={16} className="text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground">Add an artist</div>
          </button>
        </div>
      </section>

      {/* Upcoming releases */}
      <section>
        <SectionHeader eyebrow="Upcoming" title="Releases on the horizon" description="Sorted by signal strength — how confidently we think you'll care." />
        <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
          {recs.map((r, i) => (
            <div key={i} className="flex items-center gap-5 px-5 py-4">
              <div className="font-mono text-[11px] text-teal tabular w-10 text-right">
                {Math.round(r.weight * 100)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-base leading-tight">{r.entity.name}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.reason}</div>
              </div>
              <div className="font-mono text-xs text-muted-foreground tabular shrink-0">
                {String(r.entity.meta?.date ?? "")}
              </div>
              <button className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors shrink-0">
                Save
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Adjacent */}
      <section>
        <SectionHeader eyebrow="Adjacent" title="Artists that border yours" description="Reached via similar-to edges from artists you already love." />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {adjacent.map((a) => {
            const sim = relations.find(
              (r) => r.kind === "similar_to" && (r.from === a.id || r.to === a.id),
            );
            const peerId = sim ? (sim.from === a.id ? sim.to : sim.from) : null;
            const peer = peerId ? entities.find((e) => e.id === peerId) : null;
            return (
              <div key={a.id} className="rounded-lg border border-border bg-card p-4 group cursor-pointer hover:border-teal/30 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display text-base leading-tight">{a.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                      {String(a.meta?.genre ?? "")}
                    </div>
                  </div>
                  <ArrowUpRight size={14} className="text-muted-foreground group-hover:text-teal transition-colors" />
                </div>
                {peer && (
                  <div className="text-xs text-muted-foreground mt-4 leading-relaxed">
                    because you like <span className="text-foreground">{peer.name}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
