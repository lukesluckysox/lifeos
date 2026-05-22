/**
 * Seed events fallback — used when Ticketmaster API key is absent or rate-limited.
 * Curated to Jay's profile: Honolulu base, reggae/surf-rock leanings, secondary
 * coastal cities. Dates are forward-looking from 2026-05-20.
 */

export interface SeedEvent {
  id: string;
  name: string;
  category: "Music" | "Sports" | "Arts" | "Film";
  city: string;
  venue: string;
  date: string; // ISO yyyy-mm-dd
  time?: string;
  url?: string;
  reason?: string;
  moreDates?: number;
}

export const seedEvents: SeedEvent[] = [
  // Honolulu (home)
  { id: "ev-stick-figure-waikiki", name: "Stick Figure — Waikiki Shell", category: "Music", city: "Honolulu", venue: "Tom Moffatt Waikiki Shell", date: "2026-06-12", time: "19:30", reason: "Top-replayed artist · 6yr listening history" },
  { id: "ev-iya-terra-hawaiian-brian", name: "Iya Terra · Audic Empire", category: "Music", city: "Honolulu", venue: "Hawaiian Brian's", date: "2026-06-26", time: "20:00", reason: "Same scene as Stick Figure · saved tracks" },
  { id: "ev-the-movement-republik", name: "The Movement", category: "Music", city: "Honolulu", venue: "The Republik", date: "2026-07-09", time: "20:00", reason: "Saved tracks include 'Set Sail'" },
  { id: "ev-maoli-blue-note", name: "Maoli", category: "Music", city: "Honolulu", venue: "Blue Note Hawaii", date: "2026-07-18", time: "19:00", reason: "Island reggae · matches taste" },
  { id: "ev-vans-triple-crown-pipeline", name: "Vans Triple Crown — Pipe Pro", category: "Sports", city: "Haleiwa", venue: "Banzai Pipeline", date: "2026-12-08", reason: "Surf cluster · Pipeline saved" },
  { id: "ev-honolulu-film-fest", name: "Hawai'i International Film Festival", category: "Film", city: "Honolulu", venue: "Consolidated Kahala Theater", date: "2026-10-22", reason: "Coastal + indie thriller programming" },

  // California / Pacific Coast (visited)
  { id: "ev-rebelution-greek", name: "Rebelution — Bright Side Of Life Tour", category: "Music", city: "Berkeley", venue: "The Greek Theatre", date: "2026-08-15", time: "19:00", reason: "Similar to Stick Figure (90% match)" },
  { id: "ev-bottlerock", name: "BottleRock Napa Valley", category: "Music", city: "Napa", venue: "Napa Valley Expo", date: "2026-05-29", reason: "Festival weekend · summer rotation" },
  { id: "ev-warriors-clippers", name: "Warriors vs. Clippers", category: "Sports", city: "San Francisco", venue: "Chase Center", date: "2026-11-04", time: "19:30", reason: "West-coast rivalry slot" },

  // LA
  { id: "ev-odesza-bowl", name: "ODESZA — The Last Goodbye", category: "Music", city: "Los Angeles", venue: "Hollywood Bowl", date: "2026-09-19", time: "20:00", reason: "Liked artist · saved playlist match" },
  { id: "ev-lakers-warriors", name: "Lakers vs. Warriors", category: "Sports", city: "Los Angeles", venue: "Crypto.com Arena", date: "2026-11-12", time: "19:30", reason: "Marquee NBA matchup" },
  { id: "ev-tff-la", name: "Tribeca Film Festival — LA Showcase", category: "Film", city: "Los Angeles", venue: "Aero Theatre", date: "2026-06-04", reason: "Programming overlaps with thriller taste" },

  // Tokyo (place in graph)
  { id: "ev-tokyo-jazz", name: "Tokyo Jazz Festival", category: "Music", city: "Tokyo", venue: "NHK Hall", date: "2026-09-04", reason: "Tokyo in your graph · jazz adjacency" },

  // Portugal (Ericeira cluster)
  { id: "ev-meo-sudoeste", name: "MEO Sudoeste", category: "Music", city: "Lisbon", venue: "Herdade da Casa Branca", date: "2026-08-04", reason: "Lisbon visited · coastal cluster" },
  { id: "ev-wsl-ericeira", name: "WSL Pro — Ericeira", category: "Sports", city: "Ericeira", venue: "Ribeira d'Ilhas", date: "2026-10-10", reason: "Bucket-list surf cluster" },
];
