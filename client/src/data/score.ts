/**
 * Recommendation scoring — explainable, weighted, deterministic.
 *
 * Each candidate gets a score in [0, 1] composed of four signals:
 *
 *   - affinity   weight you've assigned (likes/dislikes) to this item OR adjacent items
 *   - adjacency  graph distance to entities you already love (theme/genre/director)
 *   - recency    is this a recent release / upcoming date / fresh signal?
 *   - novelty    haven't you already saved/rated it? Down-weight repeats.
 *
 * Each component is in [0, 1] and we expose them so the UI can show the math.
 */

export interface ScoreComponents {
  affinity: number;
  adjacency: number;
  recency: number;
  novelty: number;
}

export interface ScoredItem<T> {
  item: T;
  total: number;
  components: ScoreComponents;
  reasons: string[];
}

const W = { affinity: 0.40, adjacency: 0.30, recency: 0.20, novelty: 0.10 } as const;

export function combine(c: ScoreComponents): number {
  return c.affinity * W.affinity + c.adjacency * W.adjacency + c.recency * W.recency + c.novelty * W.novelty;
}

export const weights = W;

/** Score a single catalog item against user ratings + graph themes. */
export function scoreCatalog<T extends { id: string; title: string; themes: string[]; genres: string[]; year: number }>(
  item: T,
  context: {
    likedThemes: Set<string>;
    likedGenres: Set<string>;
    dislikedTitles: Set<string>;
    ratedIds: Set<string>;
    currentYear: number;
  }
): ScoredItem<T> {
  // affinity: how strongly does this overlap with liked themes/genres?
  const themeHits = item.themes.filter((t) => context.likedThemes.has(t)).length;
  const genreHits = item.genres.filter((g) => context.likedGenres.has(g)).length;
  const affinityRaw = themeHits * 0.6 + genreHits * 0.25;
  const affinity = Math.min(1, affinityRaw);

  // adjacency: anything in the same theme bucket gets a partial credit even if no direct match
  const adjacency = item.themes.length ? Math.min(1, item.themes.length * 0.3 + themeHits * 0.2) : 0.1;

  // recency: 2 years ago ≈ 1.0, 10y ≈ 0.2, decays linearly
  const ageYears = Math.max(0, context.currentYear - item.year);
  const recency = Math.max(0.1, 1 - ageYears * 0.08);

  // novelty: already rated = 0, fresh = 1
  const novelty = context.ratedIds.has(item.id) ? 0 : 1;

  // dislike override — drag total down hard
  const disliked = context.dislikedTitles.has(item.title.toLowerCase());

  const components = { affinity, adjacency, recency, novelty };
  let total = combine(components);
  if (disliked) total *= 0.2;

  const reasons: string[] = [];
  if (themeHits > 0) reasons.push(`Shares ${themeHits} theme${themeHits > 1 ? "s" : ""} with your favorites`);
  if (genreHits > 0) reasons.push(`Genre overlap (${genreHits})`);
  if (ageYears <= 2) reasons.push(`Recent — ${item.year}`);
  if (context.ratedIds.has(item.id)) reasons.push("Already on your list");
  if (disliked) reasons.push("Down-weighted: you disliked something similar");
  if (reasons.length === 0) reasons.push("Adjacent to your taste graph");

  return { item, total, components, reasons };
}

/** Score events against ratings + saved artist signals. */
export function scoreEvent<T extends { id: string; name: string; category: string; date: string; city: string }>(
  ev: T,
  context: {
    likedArtists: Set<string>; // lowercase names
    dislikedTitles: Set<string>;
    ratedIds: Set<string>;
    homeCity: string;
    today: Date;
  }
): ScoredItem<T> {
  const nameLower = ev.name.toLowerCase();
  let artistHit = false;
  context.likedArtists.forEach((a) => { if (nameLower.includes(a)) artistHit = true; });
  const affinity = artistHit ? 1 : 0.2;

  // adjacency: same city as home gets credit; otherwise partial
  const adjacency = ev.city.toLowerCase().includes(context.homeCity.toLowerCase()) ? 0.9 : 0.4;

  // recency: prefer events within next 90 days
  const evDate = new Date(ev.date);
  const days = (evDate.getTime() - context.today.getTime()) / (1000 * 60 * 60 * 24);
  let recency = 0.1;
  if (days >= 0 && days <= 30) recency = 1.0;
  else if (days <= 90) recency = 0.7;
  else if (days <= 180) recency = 0.4;
  else if (days < 0) recency = 0.0;

  const novelty = context.ratedIds.has(ev.id) ? 0 : 1;
  const components = { affinity, adjacency, recency, novelty };
  const total = combine(components);

  const reasons: string[] = [];
  if (artistHit) reasons.push("Top-replayed artist match");
  if (adjacency >= 0.8) reasons.push(`In ${ev.city} (your home base)`);
  if (recency >= 0.7) reasons.push(`Within ${Math.round(days)} days`);
  if (recency === 0) reasons.push("Already passed");
  if (reasons.length === 0) reasons.push("Adjacent to your places + taste");

  return { item: ev, total, components, reasons };
}
