/**
 * Recommendation engine — explains itself.
 *
 * Each surfaced item carries a `reason` string that traces the graph path.
 * No silent magic. The home screen leans on this so every recommendation
 * earns its place.
 */
import { entities, relations, entityById, Entity } from "./graph";

export interface Recommendation {
  entity: Entity;
  reason: string;
  weight: number;
  domain: "music" | "film" | "places" | "finance";
  cta?: string;
}

const liked = (id: string) =>
  relations.some((r) => r.from === "user" && r.kind === "likes" && r.to === id);

const visited = (id: string) =>
  relations.some((r) => r.from === "user" && r.kind === "visited" && r.to === id);

/* Music — upcoming releases by liked or adjacent artists */
export function musicRecs(): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const r of relations.filter((x) => x.kind === "released")) {
    const artist = entityById(r.from);
    const release = entityById(r.to);
    if (!artist || !release) continue;
    if (liked(artist.id)) {
      recs.push({
        entity: release,
        domain: "music",
        weight: 0.95,
        reason: `${artist.name} is one of your most-played — new release ${String(release.meta?.date ?? "")}.`,
        cta: "Add to listen-later",
      });
    } else {
      // adjacent — find similar liked artist
      const sim = relations.find(
        (x) => x.kind === "similar_to" && (x.from === artist.id || x.to === artist.id),
      );
      if (sim) {
        const peerId = sim.from === artist.id ? sim.to : sim.from;
        if (liked(peerId)) {
          recs.push({
            entity: release,
            domain: "music",
            weight: 0.7,
            reason: `Because you like ${entityById(peerId)?.name}. Adjacent artist ${artist.name} drops soon.`,
            cta: "Sample",
          });
        }
      }
    }
  }
  return recs.sort((a, b) => b.weight - a.weight);
}

/* Film — surface unwatched items in liked themes / by liked directors-actors */
export function filmRecs(): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const e of entities.filter((x) => x.kind === "film" || x.kind === "show")) {
    if (liked(e.id)) continue;

    // theme match
    const themeRel = relations.find((r) => r.from === e.id && r.kind === "grouped_with");
    if (themeRel) {
      const theme = entityById(themeRel.to);
      // does user like another item in this theme?
      const peerInTheme = relations.find(
        (r) =>
          r.kind === "grouped_with" &&
          r.to === themeRel.to &&
          r.from !== e.id &&
          liked(r.from),
      );
      if (peerInTheme && theme) {
        const peer = entityById(peerInTheme.from);
        recs.push({
          entity: e,
          domain: "film",
          weight: 0.82,
          reason: `Same world as ${peer?.name} — both anchor your ${theme.name} thread.`,
          cta: "Add to watch list",
        });
        continue;
      }
    }

    // director / actor
    const dirOrActor = relations.find(
      (r) => (r.kind === "directed" || r.kind === "starred_in") && r.to === e.id && liked(r.from),
    );
    if (dirOrActor) {
      const who = entityById(dirOrActor.from);
      recs.push({
        entity: e,
        domain: "film",
        weight: 0.86,
        reason: `Because you follow ${who?.name}.`,
        cta: "Add to watch list",
      });
    }
  }
  return recs.sort((a, b) => b.weight - a.weight);
}

/* Places — surface unvisited spots in clusters you keep returning to */
export function placeRecs(): Recommendation[] {
  const places = entities.filter((e) => e.kind === "place");
  const visitedClusters = new Map<string, number>();
  for (const p of places) {
    if (visited(p.id)) {
      const c = String(p.meta?.cluster ?? "");
      visitedClusters.set(c, (visitedClusters.get(c) ?? 0) + 1);
    }
  }
  const recs: Recommendation[] = [];
  for (const p of places) {
    if (visited(p.id)) continue;
    const c = String(p.meta?.cluster ?? "");
    const count = visitedClusters.get(c) ?? 0;
    if (count >= 1) {
      recs.push({
        entity: p,
        domain: "places",
        weight: 0.5 + count * 0.1,
        reason: `You've spent time in ${count} other ${c.replace("-", " ")} spots. This one fits the pattern.`,
        cta: "Mark to visit",
      });
    }
  }
  return recs.sort((a, b) => b.weight - a.weight);
}

/* Finance — flag concentration + recent movement */
export function financeSignals() {
  const holdings = entities.filter((e) => e.kind === "holding");
  const total = holdings.reduce((acc, h) => acc + (Number(h.meta?.weight) || 0), 0);
  const top = holdings.slice().sort((a, b) => Number(b.meta?.weight) - Number(a.meta?.weight))[0];
  const biggestMover = holdings
    .slice()
    .sort((a, b) => Math.abs(Number(b.meta?.change)) - Math.abs(Number(a.meta?.change)))[0];
  return {
    total,
    topConcentration: { holding: top, pct: Number(top?.meta?.weight) },
    biggestMover,
  };
}
