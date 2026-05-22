/**
 * Curated shows/films catalog — tuned to Jay's signal (spycraft, Central Asia
 * thrillers, surf/coast cinema, directors he follows). This is the fallback
 * when TMDB credentials aren't present.
 *
 * Each entry has a stable `id` (we prefix tmdb-style ids in real fetches so
 * ids never collide). Fields mirror the slim subset of TMDB we actually use.
 */

export interface CatalogItem {
  id: string;
  kind: "show" | "film";
  title: string;
  year: number;
  overview: string;
  posterPath?: string;
  voteAverage: number;
  genres: string[];
  /** What graph theme this fits — used by the rec engine. */
  themes: string[];
}

export const seedCatalog: CatalogItem[] = [
  // Cold-war / spycraft / Central Asia — strongest existing signal
  { id: "seed-tehran", kind: "show", title: "Tehran", year: 2020, overview: "Mossad operative deep behind Iranian lines. Slow-burn, tradecraft-heavy.", voteAverage: 7.8, genres: ["Thriller", "Drama"], themes: ["spycraft", "central-asia"] },
  { id: "seed-the-spy", kind: "show", title: "The Spy", year: 2019, overview: "Eli Cohen in 1960s Damascus. Sacha Baron Cohen drops the act entirely.", voteAverage: 7.7, genres: ["Drama", "Thriller"], themes: ["spycraft", "central-asia"] },
  { id: "seed-fauda", kind: "show", title: "Fauda", year: 2015, overview: "Israeli undercover unit working in Palestinian territories. Tight, kinetic.", voteAverage: 8.3, genres: ["Action", "Thriller"], themes: ["spycraft", "central-asia"] },
  { id: "seed-bodyguard", kind: "show", title: "Bodyguard", year: 2018, overview: "PPO assigned to a Home Secretary he disagrees with. White-knuckle pacing.", voteAverage: 8.1, genres: ["Thriller"], themes: ["spycraft"] },
  { id: "seed-jack-ryan", kind: "show", title: "Tom Clancy's Jack Ryan", year: 2018, overview: "CIA analyst pulled into the field. Globe-trots through hot zones.", voteAverage: 8.0, genres: ["Action", "Thriller"], themes: ["spycraft", "central-asia"] },
  { id: "seed-night-agent", kind: "show", title: "The Night Agent", year: 2023, overview: "FBI agent on the night-action line answers a call that detonates a conspiracy.", voteAverage: 7.5, genres: ["Thriller"], themes: ["spycraft"] },
  { id: "seed-slow-horses", kind: "show", title: "Slow Horses", year: 2022, overview: "MI5's rejects, led by a slovenly Gary Oldman, accidentally save the day.", voteAverage: 8.2, genres: ["Drama", "Thriller"], themes: ["spycraft"] },
  { id: "seed-the-americans", kind: "show", title: "The Americans", year: 2013, overview: "KGB illegals raising a family in 1980s suburban DC. Slow, surgical.", voteAverage: 8.4, genres: ["Drama", "Thriller"], themes: ["spycraft"] },
  { id: "seed-homeland", kind: "show", title: "Homeland", year: 2011, overview: "CIA analyst with bipolar disorder and a returned POW. Paranoia as a discipline.", voteAverage: 7.9, genres: ["Drama", "Thriller"], themes: ["spycraft", "central-asia"] },
  { id: "seed-citadel", kind: "show", title: "Citadel", year: 2023, overview: "Amnesiac spies rebuild the agency they used to lead.", voteAverage: 6.5, genres: ["Action", "Thriller"], themes: ["spycraft"] },
  { id: "seed-the-agency", kind: "show", title: "The Agency", year: 2024, overview: "Fassbender as a deep-cover CIA officer pulled back to London station. Cool, controlled.", voteAverage: 7.6, genres: ["Drama", "Thriller"], themes: ["spycraft"] },
  { id: "seed-the-recruit", kind: "show", title: "The Recruit", year: 2022, overview: "Rookie CIA lawyer drops into a graymail nightmare. Comedic but plotty.", voteAverage: 7.3, genres: ["Drama", "Thriller"], themes: ["spycraft"] },

  // Villeneuve / Nolan adjacent
  { id: "seed-sicario", kind: "film", title: "Sicario", year: 2015, overview: "Border-war thriller. Villeneuve at his most clinical. Del Toro's masterclass.", voteAverage: 7.6, genres: ["Action", "Crime", "Thriller"], themes: ["spycraft"] },
  { id: "seed-sicario-2", kind: "film", title: "Sicario: Day of the Soldado", year: 2018, overview: "The wolves have their own war now. Less Villeneuve, still bites.", voteAverage: 7.1, genres: ["Action", "Crime"], themes: ["spycraft"] },
  { id: "seed-tenet", kind: "film", title: "Tenet", year: 2020, overview: "Inverted entropy, espionage, and Washington. Re-watchable forever.", voteAverage: 7.3, genres: ["Action", "Sci-Fi"], themes: ["spycraft"] },
  { id: "seed-dune-2", kind: "film", title: "Dune: Part Two", year: 2024, overview: "Villeneuve's desert war machine, fully unleashed.", voteAverage: 8.4, genres: ["Sci-Fi", "Adventure"], themes: [] },
  { id: "seed-fall-guy", kind: "film", title: "The Fall Guy", year: 2024, overview: "Gosling-as-stuntman in a Hollywood mystery. Easy charm, real stunts.", voteAverage: 7.0, genres: ["Action", "Comedy"], themes: [] },
  { id: "seed-civil-war", kind: "film", title: "Civil War", year: 2024, overview: "Garland's war-correspondent road trip through a fractured America.", voteAverage: 7.2, genres: ["Drama", "War"], themes: ["spycraft"] },

  // Surf / coastal / Hawaii adjacent
  { id: "seed-chasing-mavericks", kind: "film", title: "Chasing Mavericks", year: 2012, overview: "Big-wave biopic. Imperfect but the water is honest.", voteAverage: 7.2, genres: ["Drama", "Biography"], themes: ["coastal"] },
  { id: "seed-100-foot", kind: "show", title: "100 Foot Wave", year: 2021, overview: "Garrett McNamara at Nazaré. Awe + grief + obsession.", voteAverage: 8.5, genres: ["Documentary"], themes: ["coastal"] },
  { id: "seed-momentum", kind: "film", title: "Momentum Generation", year: 2018, overview: "Slater, Machado, Dorian — the 90s crew that rewrote pro surfing.", voteAverage: 8.0, genres: ["Documentary"], themes: ["coastal"] },
  { id: "seed-andy-irons", kind: "film", title: "Andy Irons: Kissed by God", year: 2018, overview: "Kauai's prodigy. Joy, addiction, and the cost of being raw.", voteAverage: 8.4, genres: ["Documentary"], themes: ["coastal"] },
  { id: "seed-point-break", kind: "film", title: "Point Break", year: 1991, overview: "Bodhi. Utah. Endless summer wrapped in heist mythology.", voteAverage: 7.3, genres: ["Action", "Crime"], themes: ["coastal"] },

  // Drama / prestige — broaden taste graph
  { id: "seed-shogun", kind: "show", title: "Shōgun", year: 2024, overview: "Feudal Japan as a tactical chessboard. Patient, brutal, beautiful.", voteAverage: 8.7, genres: ["Drama", "History"], themes: [] },
  { id: "seed-severance", kind: "show", title: "Severance", year: 2022, overview: "Office allegory, surveillance horror, identity puzzle. Slow-burn architecture.", voteAverage: 8.7, genres: ["Drama", "Sci-Fi"], themes: [] },
  { id: "seed-true-detective", kind: "show", title: "True Detective: Night Country", year: 2024, overview: "Alaskan polar-night procedural. Foster and Reis at the edge.", voteAverage: 7.2, genres: ["Drama", "Crime"], themes: [] },
  { id: "seed-andor", kind: "show", title: "Andor", year: 2022, overview: "Le Carré meets Star Wars. The best-written show on the platform.", voteAverage: 8.5, genres: ["Sci-Fi", "Drama"], themes: ["spycraft"] },

  // Music / culture
  { id: "seed-stick-figure-doc", kind: "film", title: "Stick Figure: Set in Stone", year: 2024, overview: "On-the-road portrait. Bowman, Cocoa, the band, the hill country between gigs.", voteAverage: 8.0, genres: ["Documentary", "Music"], themes: ["coastal", "reggae"] },
  { id: "seed-marley", kind: "film", title: "Marley", year: 2012, overview: "Macdonald's definitive doc on Bob. The full arc, family included.", voteAverage: 7.9, genres: ["Documentary", "Music"], themes: ["reggae"] },
];
