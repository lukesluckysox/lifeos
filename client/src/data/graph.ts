/**
 * Life OS — Identity Graph
 *
 * The whole product is one connected graph beneath the UI. Each domain (music,
 * film, places, finance) is a slice of the same underlying entity/relationship
 * model. Recommendations are not magic — they are reasoned paths through this
 * graph.
 */

export type EntityKind =
  | "artist"
  | "release"
  | "actor"
  | "director"
  | "film"
  | "show"
  | "place"
  | "trip"
  | "account"
  | "holding"
  | "theme"
  | "favorite";

export type RelationKind =
  | "likes"
  | "visited"
  | "similar_to"
  | "directed"
  | "starred_in"
  | "released"
  | "recommended_because_of"
  | "grouped_with"
  | "owns"
  | "watchlisted"
  | "explored_after";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  meta?: Record<string, string | number | string[]>;
}

export interface Relation {
  from: string;
  to: string;
  kind: RelationKind;
  weight?: number;
  reason?: string;
}

/* ---------- Entities ---------- */

export const entities: Entity[] = [
  // --- Music ---
  { id: "a-kendrick", kind: "artist", name: "Kendrick Lamar", meta: { genre: "hip-hop", era: "2010s" } },
  { id: "a-jcole", kind: "artist", name: "J. Cole", meta: { genre: "hip-hop", era: "2010s" } },
  { id: "a-anderson-paak", kind: "artist", name: "Anderson .Paak", meta: { genre: "soul-rap" } },
  { id: "a-sticky-fingers", kind: "artist", name: "Sticky Fingers", meta: { genre: "reggae-rock" } },
  { id: "a-stick-figure", kind: "artist", name: "Stick Figure", meta: { genre: "reggae", era: "2010s" } },
  { id: "a-rebelution", kind: "artist", name: "Rebelution", meta: { genre: "reggae" } },
  { id: "a-flume", kind: "artist", name: "Flume", meta: { genre: "future-bass" } },
  { id: "a-odesza", kind: "artist", name: "ODESZA", meta: { genre: "EDM" } },

  { id: "r-pglang-2026", kind: "release", name: "pgLang — Untitled Collaborative", meta: { date: "2026-06-12", artist: "a-kendrick" } },
  { id: "r-stick-figure-tour", kind: "release", name: "Stick Figure — Tour Sessions Vol. III", meta: { date: "2026-05-30", artist: "a-stick-figure" } },
  { id: "r-odesza-remix", kind: "release", name: "ODESZA — Last Goodbye (Live Remixes)", meta: { date: "2026-05-24", artist: "a-odesza" } },
  { id: "r-rebelution-ep", kind: "release", name: "Rebelution — Coastal EP", meta: { date: "2026-06-04", artist: "a-rebelution" } },

  // --- Film ---
  { id: "f-the-fall-guy", kind: "film", name: "The Fall Guy", meta: { year: 2024 } },
  { id: "f-sicario", kind: "film", name: "Sicario", meta: { year: 2015 } },
  { id: "f-tenet", kind: "film", name: "Tenet", meta: { year: 2020 } },
  { id: "s-the-night-agent", kind: "show", name: "The Night Agent", meta: { year: 2023 } },
  { id: "s-tehran", kind: "show", name: "Tehran", meta: { year: 2020, setting: "Central Asia" } },
  { id: "s-the-spy", kind: "show", name: "The Spy", meta: { year: 2019, setting: "Middle East" } },
  { id: "s-jack-ryan", kind: "show", name: "Jack Ryan", meta: { year: 2018 } },
  { id: "s-bodyguard", kind: "show", name: "Bodyguard", meta: { year: 2018 } },

  { id: "d-villeneuve", kind: "director", name: "Denis Villeneuve" },
  { id: "d-nolan", kind: "director", name: "Christopher Nolan" },

  { id: "ac-gosling", kind: "actor", name: "Ryan Gosling" },
  { id: "ac-blunt", kind: "actor", name: "Emily Blunt" },
  { id: "ac-deltoro", kind: "actor", name: "Benicio del Toro" },

  // --- Places ---
  { id: "p-pipeline", kind: "place", name: "Pipeline, Oahu", meta: { cluster: "surf", region: "Hawaii", lat: 21.66, lng: -158.06 } },
  { id: "p-trestles", kind: "place", name: "Lower Trestles", meta: { cluster: "surf", region: "California", lat: 33.38, lng: -117.58 } },
  { id: "p-malibu", kind: "place", name: "Malibu First Point", meta: { cluster: "surf", region: "California" } },
  { id: "p-ericeira", kind: "place", name: "Ericeira", meta: { cluster: "surf", region: "Portugal" } },
  { id: "p-bigsur", kind: "place", name: "Big Sur Drive", meta: { cluster: "scenic-drive", region: "California" } },
  { id: "p-pch1", kind: "place", name: "PCH — Mendocino to Bodega", meta: { cluster: "scenic-drive", region: "California" } },
  { id: "p-tokyo", kind: "place", name: "Tokyo", meta: { cluster: "city", region: "Japan" } },
  { id: "p-lisbon", kind: "place", name: "Lisbon", meta: { cluster: "city", region: "Portugal" } },
  { id: "p-honolulu", kind: "place", name: "Honolulu", meta: { cluster: "city", region: "Hawaii" } },
  { id: "p-nobu-malibu", kind: "place", name: "Nobu Malibu", meta: { cluster: "restaurant", region: "California" } },
  { id: "p-helena", kind: "place", name: "Helena's Hawaiian Food", meta: { cluster: "restaurant", region: "Hawaii" } },
  { id: "p-koko", kind: "place", name: "Koko Crater Trail", meta: { cluster: "hike", region: "Hawaii" } },
  { id: "p-half-dome", kind: "place", name: "Half Dome", meta: { cluster: "hike", region: "California" } },

  // --- Finance ---
  { id: "ac-brokerage", kind: "account", name: "Brokerage — Fidelity", meta: { value: 184320 } },
  { id: "ac-roth", kind: "account", name: "Roth IRA", meta: { value: 62410 } },
  { id: "ac-checking", kind: "account", name: "Checking", meta: { value: 14250 } },

  { id: "h-aapl", kind: "holding", name: "AAPL", meta: { weight: 18, change: 2.4 } },
  { id: "h-nvda", kind: "holding", name: "NVDA", meta: { weight: 22, change: 5.1 } },
  { id: "h-msft", kind: "holding", name: "MSFT", meta: { weight: 14, change: 0.9 } },
  { id: "h-spy", kind: "holding", name: "VOO", meta: { weight: 24, change: 1.2 } },
  { id: "h-btc", kind: "holding", name: "BTC", meta: { weight: 12, change: -1.8 } },
  { id: "h-cash", kind: "holding", name: "Cash & T-Bills", meta: { weight: 10, change: 0.1 } },

  // --- Themes (the connective tissue) ---
  { id: "t-coast-mind", kind: "theme", name: "Coastal Mindset" },
  { id: "t-spycraft", kind: "theme", name: "Cold-War Spycraft" },
  { id: "t-low-fi-luxury", kind: "theme", name: "Low-Fi Luxury" },
];

/* ---------- Relations ---------- */

export const relations: Relation[] = [
  // Music likes + adjacency
  { from: "user", to: "a-kendrick", kind: "likes", weight: 0.95 },
  { from: "user", to: "a-jcole", kind: "likes", weight: 0.88 },
  { from: "user", to: "a-stick-figure", kind: "likes", weight: 0.92 },
  { from: "user", to: "a-odesza", kind: "likes", weight: 0.8 },
  { from: "a-kendrick", to: "a-jcole", kind: "similar_to", weight: 0.85 },
  { from: "a-kendrick", to: "a-anderson-paak", kind: "similar_to", weight: 0.72 },
  { from: "a-stick-figure", to: "a-rebelution", kind: "similar_to", weight: 0.9 },
  { from: "a-stick-figure", to: "a-sticky-fingers", kind: "similar_to", weight: 0.65 },
  { from: "a-odesza", to: "a-flume", kind: "similar_to", weight: 0.82 },

  // Releases
  { from: "a-kendrick", to: "r-pglang-2026", kind: "released" },
  { from: "a-stick-figure", to: "r-stick-figure-tour", kind: "released" },
  { from: "a-odesza", to: "r-odesza-remix", kind: "released" },
  { from: "a-rebelution", to: "r-rebelution-ep", kind: "released" },

  // Film likes
  { from: "user", to: "f-sicario", kind: "likes", weight: 0.92 },
  { from: "user", to: "f-tenet", kind: "likes", weight: 0.86 },
  { from: "user", to: "ac-gosling", kind: "likes", weight: 0.78 },
  { from: "user", to: "ac-blunt", kind: "likes", weight: 0.82 },
  { from: "user", to: "d-villeneuve", kind: "likes", weight: 0.93 },
  { from: "user", to: "s-tehran", kind: "likes", weight: 0.9 },

  { from: "d-villeneuve", to: "f-sicario", kind: "directed" },
  { from: "d-nolan", to: "f-tenet", kind: "directed" },
  { from: "ac-blunt", to: "f-sicario", kind: "starred_in" },
  { from: "ac-deltoro", to: "f-sicario", kind: "starred_in" },
  { from: "ac-gosling", to: "f-the-fall-guy", kind: "starred_in" },

  // Show adjacency / spycraft theme
  { from: "s-tehran", to: "t-spycraft", kind: "grouped_with" },
  { from: "s-the-spy", to: "t-spycraft", kind: "grouped_with" },
  { from: "s-the-night-agent", to: "t-spycraft", kind: "grouped_with" },
  { from: "s-jack-ryan", to: "t-spycraft", kind: "grouped_with" },
  { from: "s-bodyguard", to: "t-spycraft", kind: "grouped_with" },
  { from: "f-sicario", to: "t-spycraft", kind: "grouped_with" },
  { from: "f-tenet", to: "t-spycraft", kind: "grouped_with" },

  // Places visited
  { from: "user", to: "p-pipeline", kind: "visited" },
  { from: "user", to: "p-trestles", kind: "visited" },
  { from: "user", to: "p-malibu", kind: "visited" },
  { from: "user", to: "p-bigsur", kind: "visited" },
  { from: "user", to: "p-honolulu", kind: "visited" },
  { from: "user", to: "p-koko", kind: "visited" },
  { from: "user", to: "p-helena", kind: "visited" },
  { from: "user", to: "p-nobu-malibu", kind: "visited" },
  { from: "user", to: "p-half-dome", kind: "visited" },
  { from: "user", to: "p-lisbon", kind: "visited" },

  // Place adjacency via themes
  { from: "p-pipeline", to: "t-coast-mind", kind: "grouped_with" },
  { from: "p-trestles", to: "t-coast-mind", kind: "grouped_with" },
  { from: "p-malibu", to: "t-coast-mind", kind: "grouped_with" },
  { from: "p-ericeira", to: "t-coast-mind", kind: "grouped_with" },
  { from: "p-bigsur", to: "t-coast-mind", kind: "grouped_with" },

  // Finance ownership
  { from: "user", to: "ac-brokerage", kind: "owns" },
  { from: "user", to: "ac-roth", kind: "owns" },
  { from: "user", to: "ac-checking", kind: "owns" },
  { from: "ac-brokerage", to: "h-aapl", kind: "owns" },
  { from: "ac-brokerage", to: "h-nvda", kind: "owns" },
  { from: "ac-brokerage", to: "h-msft", kind: "owns" },
  { from: "ac-brokerage", to: "h-spy", kind: "owns" },
  { from: "ac-brokerage", to: "h-btc", kind: "owns" },
  { from: "ac-brokerage", to: "h-cash", kind: "owns" },
];

/* ---------- Helpers ---------- */

export const entityById = (id: string) => entities.find((e) => e.id === id);

export const relatedTo = (id: string, kind?: RelationKind) =>
  relations.filter((r) => (r.from === id || r.to === id) && (!kind || r.kind === kind));

export const userLikes = () =>
  relations.filter((r) => r.from === "user" && r.kind === "likes").map((r) => entityById(r.to)!).filter(Boolean);

export const userVisited = () =>
  relations.filter((r) => r.from === "user" && r.kind === "visited").map((r) => entityById(r.to)!).filter(Boolean);
