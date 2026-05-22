import { ArrowUpRight } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { AddItem } from "@/components/AddItem";
import { entities, relations } from "@/data/graph";
import { filmRecs } from "@/data/recs";

export default function Film() {
  const likedPeople = relations
    .filter((r) => r.from === "user" && r.kind === "likes")
    .map((r) => entities.find((e) => e.id === r.to))
    .filter((e): e is NonNullable<typeof e> => !!e && (e.kind === "actor" || e.kind === "director"));

  const likedFilms = relations
    .filter((r) => r.from === "user" && r.kind === "likes")
    .map((r) => entities.find((e) => e.id === r.to))
    .filter((e): e is NonNullable<typeof e> => !!e && (e.kind === "film" || e.kind === "show"));

  const recs = filmRecs();

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Film</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          A directors-and-themes view, not a streaming pile.
        </h1>
      </section>

      {/* Favorites split */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div>
          <SectionHeader eyebrow="People you follow" title="Directors & actors" />
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {likedPeople.map((p) => (
              <div key={p.id} className="px-5 py-3.5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                    {p.kind}
                  </div>
                </div>
                <ArrowUpRight size={13} className="text-muted-foreground" />
              </div>
            ))}
            <div className="px-3 py-2">
              <AddItem
                kind="artist"
                label="Add director or actor"
                titlePlaceholder="Name"
                subtitlePlaceholder="Role (director / actor)"
                size="compact"
              />
            </div>
          </div>
        </div>
        <div>
          <SectionHeader eyebrow="Anchors" title="Films & shows you loved" />
          <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
            {likedFilms.map((f) => (
              <div key={f.id} className="px-5 py-3.5 flex items-center justify-between">
                <div className="font-display text-base">{f.name}</div>
                <div className="font-mono text-[10px] text-muted-foreground tabular">{String(f.meta?.year ?? "")}</div>
              </div>
            ))}
            <div className="px-3 py-2 flex gap-2 flex-wrap">
              <AddItem
                kind="film"
                label="Add film"
                titlePlaceholder="Film title"
                subtitlePlaceholder="Year (optional)"
                size="compact"
              />
              <AddItem
                kind="show"
                label="Add show"
                titlePlaceholder="Show title"
                subtitlePlaceholder="Year (optional)"
                size="compact"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Recs */}
      <section>
        <SectionHeader
          eyebrow="Recommended"
          title="Adjacent to what you already love"
          description="Each card explains the path through the graph that surfaced it."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recs.map((r, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 group cursor-pointer hover:border-rose/30 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="eyebrow text-rose">{r.entity.kind}</div>
                <div className="font-mono text-[10px] tabular text-rose">{Math.round(r.weight * 100)}%</div>
              </div>
              <div className="font-display text-xl leading-tight">{r.entity.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground tabular mt-1">
                {String(r.entity.meta?.year ?? "")} {r.entity.meta?.setting ? `· ${r.entity.meta.setting}` : ""}
              </div>
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{r.reason}</p>
              <div className="mt-5 text-[11px] font-mono uppercase tracking-[0.15em] text-foreground/80 group-hover:text-foreground flex items-center gap-1.5">
                {r.cta} <ArrowUpRight size={12} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
