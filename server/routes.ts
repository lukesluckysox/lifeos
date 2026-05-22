import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storage } from "./storage";
import { insertRatingSchema, insertHoldingSchema, insertWatchlistSchema, insertSubscriptionSchema, insertFoodSpotSchema, insertRecFeedbackSchema, insertUserItemSchema } from "@shared/schema";
import * as Spotify from "./spotify";
import { seedCatalog, type CatalogItem } from "./catalog-seed";
import { seedEvents, type SeedEvent } from "./events-seed";

const TMDB_KEY = process.env.TMDB_API_KEY;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

/* ------------ helpers ------------ */

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  if (!TMDB_KEY) return null;
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params }).toString();
  const url = `https://api.themoviedb.org/3${path}?${qs}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function tmdbToCatalogItem(it: any, kind: "show" | "film"): CatalogItem {
  return {
    id: `tmdb-${kind}-${it.id}`,
    kind,
    title: kind === "show" ? it.name : it.title,
    year: parseInt((kind === "show" ? it.first_air_date : it.release_date)?.slice(0, 4) || "0", 10),
    overview: it.overview || "",
    posterPath: it.poster_path ? `https://image.tmdb.org/t/p/w342${it.poster_path}` : undefined,
    voteAverage: it.vote_average || 0,
    genres: [],
    themes: [],
  };
}

async function tmFetch(params: Record<string, string>) {
  if (!TM_KEY) return null;
  const qs = new URLSearchParams({ apikey: TM_KEY, ...params }).toString();
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${qs}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function tmToEvent(e: any): SeedEvent {
  const venue = e?._embedded?.venues?.[0];
  const segment = e?.classifications?.[0]?.segment?.name;
  const cat: SeedEvent["category"] =
    segment === "Music" ? "Music" :
    segment === "Sports" ? "Sports" :
    segment === "Film" ? "Film" : "Arts";
  return {
    id: `tm-${e.id}`,
    name: e.name,
    category: cat,
    city: venue?.city?.name || "",
    venue: venue?.name || "",
    date: e?.dates?.start?.localDate || "",
    time: e?.dates?.start?.localTime?.slice(0, 5),
    url: e.url,
  };
}

/* ------------ feedback-aware reranking ------------ */

/**
 * Reorder rec items based on stored 👍 / 👎 feedback.
 *  - Items the user already 👎'd → dropped completely.
 *  - Items already 👍'd → soft-boost so they stay near the top.
 *  - For unrated items: text-similarity boost vs the union of liked-item text → items similar to past 👍s rise.
 * Returns { items, learning } where learning is a short hint to surface in the UI.
 */
async function rerankWithFeedback<T>(
  items: T[],
  kind: string,
  idFn: (it: T) => string,
  textFn: (it: T) => string,
): Promise<{ items: T[]; learning: { dropped: number; boosted: number; basis: string[] } }> {
  let feedback: { externalId: string; signal: number }[] = [];
  try {
    feedback = (await storage.listRecFeedback(kind)) as any;
  } catch {
    return { items, learning: { dropped: 0, boosted: 0, basis: [] } };
  }
  if (!feedback.length) return { items, learning: { dropped: 0, boosted: 0, basis: [] } };

  const upIds = new Set(feedback.filter((f) => f.signal === 1).map((f) => f.externalId));
  const downIds = new Set(feedback.filter((f) => f.signal === -1).map((f) => f.externalId));

  // Build a token bag from liked items' text to score similarity
  const likedTokens = new Set<string>();
  for (const it of items) {
    if (upIds.has(idFn(it))) {
      for (const tok of tokenize(textFn(it))) likedTokens.add(tok);
    }
  }
  // Also seed from external_id parts of liked feedback (e.g. "sight:Honolulu:Diamond Head" → Honolulu, Diamond, Head)
  for (const f of feedback) {
    if (f.signal !== 1) continue;
    for (const tok of tokenize(f.externalId.replace(/[:_-]+/g, " "))) likedTokens.add(tok);
  }

  let dropped = 0;
  let boosted = 0;
  const scored = items
    .filter((it) => {
      if (downIds.has(idFn(it))) { dropped++; return false; }
      return true;
    })
    .map((it, idx) => {
      let score = -idx; // preserve original order as baseline
      if (upIds.has(idFn(it))) { score += 1000; boosted++; }
      // Similarity score: count of shared tokens with liked set
      if (likedTokens.size) {
        const toks = tokenize(textFn(it));
        let overlap = 0;
        for (const t of toks) if (likedTokens.has(t)) overlap++;
        if (overlap > 0) score += overlap * 5;
      }
      return { it, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.it);

  const basis = Array.from(likedTokens).slice(0, 5);
  return { items: scored, learning: { dropped, boosted, basis } };
}

function tokenize(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/* ------------ routes ------------ */

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ----- Catalog (shows + films) -----
  app.get("/api/catalog", async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();
    const kind = req.query.kind as "show" | "film" | undefined;

    // Build user-pinned catalog items (films/shows) — merged into every response path
    async function getUserCatalogItems(): Promise<CatalogItem[]> {
      try {
        const pinFilm = kind === "show" ? [] : await storage.listUserItems("film");
        const pinShow = kind === "film" ? [] : await storage.listUserItems("show");
        const ql = q ? q.toLowerCase() : "";
        return [
          ...pinFilm.map((p: any) => ({ ...p, _kind: "film" as const })),
          ...pinShow.map((p: any) => ({ ...p, _kind: "show" as const })),
        ]
          .filter((p: any) => !q || (p.title || "").toLowerCase().includes(ql))
          .map((p: any) => ({
            id: `user-${p.id}`,
            kind: p._kind,
            title: p.title,
            year: Number((p.subtitle || "").match(/\d{4}/)?.[0]) || 0,
            posterPath: "",
            overview: p.subtitle || "Added by you",
            voteAverage: 0,
            genres: [],
            themes: [],
            pinned: true,
            userItemId: p.id,
          } as CatalogItem & { pinned: boolean; userItemId: number }));
      } catch { return []; }
    }

    const userItems = await getUserCatalogItems();

    // TMDB live path (if key present)
    if (TMDB_KEY && q) {
      const data = await tmdbFetch("/search/multi", { query: q, include_adult: "false", page: "1" });
      if (data?.results) {
        const items: CatalogItem[] = data.results
          .filter((r: any) => r.media_type === "tv" || r.media_type === "movie")
          .filter((r: any) => !kind || (kind === "show" ? r.media_type === "tv" : r.media_type === "movie"))
          .map((r: any) => tmdbToCatalogItem(r, r.media_type === "tv" ? "show" : "film"))
          .slice(0, 40);
        return res.json({ source: "tmdb", items: [...userItems, ...items] });
      }
    }
    if (TMDB_KEY && !q) {
      // discover popular as default
      const [tv, mv] = await Promise.all([
        tmdbFetch("/trending/tv/week"),
        tmdbFetch("/trending/movie/week"),
      ]);
      const items: CatalogItem[] = [
        ...(tv?.results ?? []).map((r: any) => tmdbToCatalogItem(r, "show")),
        ...(mv?.results ?? []).map((r: any) => tmdbToCatalogItem(r, "film")),
      ].slice(0, 40);
      if (items.length) return res.json({ source: "tmdb", items: [...userItems, ...items] });
    }

    // Fallback: seed catalog
    let items = seedCatalog.slice();
    if (kind) items = items.filter(i => i.kind === kind);
    if (q) {
      const ql = q.toLowerCase();
      items = items.filter(i =>
        i.title.toLowerCase().includes(ql) ||
        i.overview.toLowerCase().includes(ql) ||
        i.genres.some(g => g.toLowerCase().includes(ql))
      );
    }
    res.json({ source: "seed", items: [...userItems, ...items] });
  });

  // ----- Events (Ticketmaster + seed) -----
  app.get("/api/events", async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim();
    const category = req.query.category as SeedEvent["category"] | undefined;

    // Try live Ticketmaster
    if (TM_KEY) {
      const params: Record<string, string> = { size: "40", sort: "date,asc" };
      if (city) params.city = city;
      if (category) {
        params.segmentName = category === "Film" ? "Film" : category;
      }
      const data = await tmFetch(params);
      const liveRaw: SeedEvent[] = (data?._embedded?.events ?? []).map(tmToEvent);
      // Dedupe by (name + venue) — keep the soonest performance, count the rest
      const byKey = new Map<string, SeedEvent & { moreDates?: number }>();
      for (const e of liveRaw) {
        const key = `${e.name}::${e.venue}`.toLowerCase();
        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, { ...e, moreDates: 0 });
        } else {
          // Keep the earlier date
          if (e.date && (!prev.date || e.date < prev.date)) {
            byKey.set(key, { ...e, moreDates: (prev.moreDates || 0) + 1 });
          } else {
            prev.moreDates = (prev.moreDates || 0) + 1;
          }
        }
      }
      const live = Array.from(byKey.values()).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      if (live.length) {
        return res.json({ source: "ticketmaster", city: city || "any", items: live });
      }
    }

    // Fallback: seed (filter)
    let items = seedEvents.slice();
    if (city) {
      const cl = city.toLowerCase();
      items = items.filter(e => e.city.toLowerCase().includes(cl));
    }
    if (category) items = items.filter(e => e.category === category);
    res.json({ source: "seed", city: city || "any", items });
  });

  // ----- Ratings -----
  app.get("/api/ratings", async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const items = await storage.listRatings(kind);
    res.json(items.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })));
  });

  app.post("/api/ratings", async (req, res) => {
    const body = { ...req.body, meta: typeof req.body.meta === "object" ? JSON.stringify(req.body.meta) : req.body.meta };
    const parsed = insertRatingSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid rating", errors: parsed.error.flatten() });
    }
    const r = await storage.upsertRating(parsed.data);
    res.json({ ...r, meta: r.meta ? JSON.parse(r.meta) : null });
  });

  app.delete("/api/ratings/:kind/:externalId", async (req, res) => {
    const out = await storage.removeRating(req.params.kind, req.params.externalId);
    res.json(out);
  });

  // ----- Status (lets the client know which sources are live) -----
  app.get("/api/status", (_req, res) => {
    res.json({
      tmdb: Boolean(TMDB_KEY),
      ticketmaster: Boolean(TM_KEY),
      now: new Date().toISOString(),
    });
  });

  /* ============ Portfolio ============ */

  // Real Plaid snapshot (refreshed by agent) + any manually entered holdings
  app.get("/api/portfolio", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const fileName = mode === "demo" ? "portfolio-snapshot-demo.json" : "portfolio-snapshot.json";
    let snapshot: any = null;
    try {
      const candidates = [
        join(process.cwd(), `server/data/${fileName}`),
        join(process.cwd(), `data/${fileName}`),
        join(process.cwd(), `../server/data/${fileName}`),
      ];
      for (const p of candidates) {
        try { snapshot = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
      }
    } catch {}

    // In demo mode, hide manual holdings (those are personal entries)
    const manual = mode === "demo" ? [] : await storage.listHoldings();
    // Fetch current prices for manual holdings
    const stockSymbols = manual.filter(h => h.kind === "stock").map(h => h.symbol);
    const cryptoSymbols = manual.filter(h => h.kind === "crypto").map(h => h.symbol);
    const [stockPrices, cryptoPrices] = await Promise.all([
      stockSymbols.length ? fetchStockPrices(stockSymbols) : {},
      cryptoSymbols.length ? fetchCryptoPrices(cryptoSymbols) : {},
    ]);
    const manualEnriched = manual.map(h => {
      const px = h.kind === "stock" ? stockPrices[h.symbol] : cryptoPrices[h.symbol.toUpperCase()];
      const price = px?.price ?? h.costBasis;
      const dayChangePct = px?.dayChangePct ?? 0;
      const value = h.quantity * price;
      const cost = h.quantity * h.costBasis;
      const gainAbs = value - cost;
      const gainPct = cost ? (gainAbs / cost) * 100 : 0;
      return {
        id: h.id,
        kind: h.kind,
        symbol: h.symbol,
        name: h.name || px?.name || h.symbol,
        quantity: h.quantity,
        costBasis: h.costBasis,
        price,
        value,
        dayChangePct,
        gainAbs,
        gainPct,
        priceSource: px ? (h.kind === "stock" ? "yahoo" : "coingecko") : "costBasis",
      };
    });

    res.json({
      source: snapshot ? (mode === "demo" ? "demo" : "plaid+manual") : (manual.length ? "manual" : "empty"),
      mode,
      plaid: snapshot,
      manual: manualEnriched,
      asOf: new Date().toISOString(),
    });
  });

  /* ============ Holdings (manual entry) ============ */

  app.get("/api/holdings", async (req, res) => {
    const kind = req.query.kind as string | undefined;
    res.json(await storage.listHoldings(kind));
  });

  app.post("/api/holdings", async (req, res) => {
    const parsed = insertHoldingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid holding", errors: parsed.error.flatten() });
    if (!['stock','crypto'].includes(parsed.data.kind)) return res.status(400).json({ message: "kind must be 'stock' or 'crypto'" });
    const h = await storage.addHolding(parsed.data);
    res.json(h);
  });

  app.patch("/api/holdings/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const h = await storage.updateHolding(id, req.body);
    if (!h) return res.status(404).json({ message: "Holding not found" });
    res.json(h);
  });

  app.delete("/api/holdings/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.json(await storage.removeHolding(id));
  });

  /* ============ Index funds & crypto reference quotes ============ */

  app.get("/api/index-quote/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    // Detect crypto by common symbols
    const cryptoMap: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", AVAX: "avalanche-2", MATIC: "matic-network", LINK: "chainlink", DOT: "polkadot" };
    const isCrypto = symbol in cryptoMap;
    try {
      if (isCrypto) {
        const r = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoMap[symbol]}/market_chart?vs_currency=usd&days=365&interval=daily`);
        if (!r.ok) return res.status(502).json({ message: "crypto fetch failed" });
        const data = await r.json();
        const prices: [number, number][] = data.prices;
        if (!prices?.length) return res.status(404).json({ message: "no data" });
        const first = prices[0][1];
        const last = prices[prices.length - 1][1];
        const ytdStartIdx = prices.findIndex(([t]) => new Date(t).getFullYear() === new Date().getFullYear());
        const ytdStart = ytdStartIdx >= 0 ? prices[ytdStartIdx][1] : first;
        return res.json({
          symbol, kind: "crypto", name: symbol,
          currentPrice: last,
          oneYearReturnPct: ((last - first) / first) * 100,
          ytdReturnPct: ((last - ytdStart) / ytdStart) * 100,
          series: prices.filter((_, i) => i % 7 === 0).map(([t, p]) => ({ t, p })),
        });
      }
      // Yahoo Finance for stocks/ETFs
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1wk`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!r.ok) return res.status(502).json({ message: "yahoo fetch failed" });
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result) return res.status(404).json({ message: "no data" });
      const meta = result.meta;
      const closes: number[] = result.indicators.quote[0].close.filter((c: any) => c != null);
      const stamps: number[] = result.timestamp;
      const first = closes[0];
      const last = meta.regularMarketPrice ?? closes[closes.length - 1];
      const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
      const ytdStartIdx = stamps.findIndex(t => t >= yearStart);
      const ytdStart = ytdStartIdx >= 0 ? closes[ytdStartIdx] : first;
      res.json({
        symbol, kind: "stock", name: symbol,
        currentPrice: last,
        oneYearReturnPct: ((last - first) / first) * 100,
        ytdReturnPct: ((last - ytdStart) / ytdStart) * 100,
        series: stamps.map((t, i) => ({ t: t * 1000, p: closes[i] })).filter(s => s.p != null),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /* ============ Music recs (Spotify snapshot) ============ */

  app.get("/api/music-recs", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const section = (req.query.section as string | undefined) || "recent"; // recent | top | new
    try {
      // Demo mode: keep using snapshot so demo flow still works for guests
      if (mode === "demo") {
        const snap = loadSnapshot<any>("music-snapshot-demo.json") || { source: "none", tracks: [] };
        if (Array.isArray(snap.tracks)) {
          const { items, learning } = await rerankWithFeedback(
            snap.tracks, "music",
            (t: any) => String(t.id || t.name),
            (t: any) => `${t.name || ""} ${t.artist || ""} ${t.album || ""}`,
          );
          snap.tracks = items;
          snap.learning = learning;
        }
        return res.json(snap);
      }

      // Live mode: real Spotify, requires authorization
      const st = await Spotify.status();
      if (!st.authorized) {
        return res.json({ source: "unauthorized", tracks: [], reason: "connect-spotify" });
      }
      let snap: any;
      if (section === "top") snap = await Spotify.getTopTracks("short_term", 20);
      else if (section === "new") snap = await Spotify.getNewReleasesFromFollowed({ limit: 20, daysBack: 60 });
      else snap = await Spotify.getRecentlyPlayed(20);

      // Merge in user-pinned music
      const pinned = await storage.listUserItems("music");
      const pinnedTracks = pinned.map(p => ({
        id: `user-${p.id}`,
        name: p.title,
        artist: p.subtitle || "",
        url: p.url || undefined,
        pinned: true,
        playedAt: new Date(p.createdAt).toISOString(),
      }));
      snap.tracks = [...pinnedTracks, ...snap.tracks];

      const { items, learning } = await rerankWithFeedback(
        snap.tracks, "music",
        (t: any) => String(t.id || t.name),
        (t: any) => `${t.name || ""} ${t.artist || ""} ${t.album || ""}`,
      );
      snap.tracks = items;
      snap.learning = learning;
      res.json(snap);
    } catch (e: any) {
      console.error("music-recs error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  /* ============ Spotify auth + status ============ */
  app.get("/api/spotify/status", async (_req, res) => {
    try { res.json(await Spotify.status()); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/spotify/config", async (req, res) => {
    try {
      const { clientId, clientSecret, redirectUri } = req.body || {};
      if (!clientId || !clientSecret) return res.status(400).json({ message: "clientId and clientSecret required" });
      await Spotify.saveConfig({ clientId, clientSecret, redirectUri });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.get("/api/spotify/authorize", async (_req, res) => {
    try {
      const cfg = await Spotify.getConfig();
      if (!cfg) return res.status(400).json({ message: "Spotify not configured. POST /api/spotify/config first." });
      const state = Math.random().toString(36).slice(2);
      const url = Spotify.buildAuthorizeUrl(cfg, state);
      res.json({ url });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.get("/api/spotify/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const err = req.query.error as string | undefined;
    if (err) return res.status(400).send(`Spotify authorization failed: ${err}`);
    if (!code) return res.status(400).send("Missing code");
    try {
      const tok = await Spotify.exchangeCodeForToken(code);
      if (tok.refresh_token) await Spotify.saveRefreshToken(tok.refresh_token);
      res.send(`<!doctype html><html><body style="font-family:system-ui;background:#0b0b0b;color:#fff;padding:48px;"><h1>Spotify connected.</h1><p>You can close this tab and refresh Life OS.</p><script>setTimeout(()=>{ if (window.opener) { try { window.opener.postMessage({ type: 'spotify-connected' }, '*'); } catch {} window.close(); } }, 600);</script></body></html>`);
    } catch (e: any) {
      res.status(500).send(`Token exchange failed: ${e.message}`);
    }
  });
  app.post("/api/spotify/disconnect", async (_req, res) => {
    try { await Spotify.clearAuth(); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /* ============ User items (add-your-own across kinds) ============ */
  app.get("/api/user-items", async (req, res) => {
    try {
      const kind = req.query.kind as string | undefined;
      res.json(await storage.listUserItems(kind));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/user-items", async (req, res) => {
    try {
      const parsed = insertUserItemSchema.parse(req.body);
      const row = await storage.addUserItem(parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/user-items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await storage.removeUserItem(id);
      res.json(r);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  /* ============ Places to visit (Ticketmaster Arts + scenic) ============ */

  app.get("/api/places-recs", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const city = (req.query.city as string | undefined)?.trim() || (mode === "demo" ? "Los Angeles" : "Honolulu");
    if (mode === "demo") {
      return res.json({
        source: "demo",
        city,
        places: [
          { venue: "The Getty Center", city: "Los Angeles", nextEvent: "Renaissance Drawings", count: 4, date: "2026-06-12", url: "https://www.getty.edu" },
          { venue: "Hollywood Bowl", city: "Los Angeles", nextEvent: "LA Phil Summer Series", count: 8, date: "2026-06-18", url: "https://www.hollywoodbowl.com" },
          { venue: "LACMA", city: "Los Angeles", nextEvent: "Modern Art Wing Opening", count: 3, date: "2026-06-22", url: "https://www.lacma.org" },
          { venue: "The Broad", city: "Los Angeles", nextEvent: "Yayoi Kusama: Infinity", count: 5, date: "2026-06-25", url: "https://www.thebroad.org" },
          { venue: "Greek Theatre", city: "Los Angeles", nextEvent: "Summer Concert Series", count: 6, date: "2026-07-02", url: "https://lagreektheatre.com" },
          { venue: "Walt Disney Concert Hall", city: "Los Angeles", nextEvent: "Dudamel Conducts Mahler", count: 4, date: "2026-07-08", url: "https://www.laphil.com" },
          { venue: "Griffith Observatory", city: "Los Angeles", nextEvent: "All Space Considered", count: 2, date: "2026-07-10", url: "https://griffithobservatory.org" },
          { venue: "The Wiltern", city: "Los Angeles", nextEvent: "Indie Night", count: 3, date: "2026-07-15", url: "https://www.wiltern.com" },
        ],
      });
    }
    if (TM_KEY) {
      // Use Ticketmaster Arts/Family classifications as proxy for cultural "places to visit" near user
      const data = await tmFetch({ size: "60", city, sort: "date,asc", classificationName: "Arts" });
      const events: SeedEvent[] = (data?._embedded?.events ?? []).map(tmToEvent);
      // Group by venue — a venue = a place worth visiting
      const byVenue = new Map<string, { venue: string; city: string; nextEvent: string; count: number; date: string; url?: string }>();
      for (const e of events) {
        if (!e.venue) continue;
        const key = `${e.venue}::${e.city}`.toLowerCase();
        const prev = byVenue.get(key);
        if (!prev || (e.date && e.date < prev.date)) {
          byVenue.set(key, { venue: e.venue, city: e.city, nextEvent: e.name, count: (prev?.count || 0) + 1, date: e.date, url: e.url });
        } else {
          prev.count += 1;
        }
      }
      const places = Array.from(byVenue.values()).sort((a, b) => b.count - a.count).slice(0, 8);
      if (places.length) return res.json({ source: "ticketmaster", city, places });
    }
    res.json({ source: "none", city, places: [] });
  });

  /* ============ Watchlist ============ */

  app.get("/api/watchlist", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    if (mode === "demo") {
      // Demo watchlist — a few popular names
      const demo = [
        { id: -1, kind: "stock", symbol: "AMD",  name: "Advanced Micro Devices", note: "AI infra exposure", createdAt: Date.now() },
        { id: -2, kind: "stock", symbol: "PLTR", name: "Palantir Technologies",  note: "Govt + commercial AI", createdAt: Date.now() },
        { id: -3, kind: "stock", symbol: "SHOP", name: "Shopify",                note: "Ecom platform play",   createdAt: Date.now() },
        { id: -4, kind: "crypto", symbol: "SOL", name: "Solana",                 note: "Watching for breakout", createdAt: Date.now() },
      ];
      const stockSyms = demo.filter(d => d.kind === "stock").map(d => d.symbol);
      const cryptoSyms = demo.filter(d => d.kind === "crypto").map(d => d.symbol);
      const [sp, cp] = await Promise.all([
        stockSyms.length ? fetchStockPrices(stockSyms) : {},
        cryptoSyms.length ? fetchCryptoPrices(cryptoSyms) : {},
      ]);
      const enriched = demo.map(w => {
        const px = w.kind === "stock" ? sp[w.symbol] : cp[w.symbol.toUpperCase()];
        return { ...w, price: px?.price ?? null, dayChangePct: px?.dayChangePct ?? null };
      });
      return res.json(enriched);
    }
    const kind = req.query.kind as string | undefined;
    const items = await storage.listWatchlist(kind);
    const stockSyms = items.filter(w => w.kind === "stock").map(w => w.symbol);
    const cryptoSyms = items.filter(w => w.kind === "crypto").map(w => w.symbol);
    const [sp, cp] = await Promise.all([
      stockSyms.length ? fetchStockPrices(stockSyms) : {},
      cryptoSyms.length ? fetchCryptoPrices(cryptoSyms) : {},
    ]);
    const enriched = items.map(w => {
      const px = w.kind === "stock" ? sp[w.symbol] : cp[w.symbol.toUpperCase()];
      return { ...w, price: px?.price ?? null, dayChangePct: px?.dayChangePct ?? null };
    });
    res.json(enriched);
  });

  app.post("/api/watchlist", async (req, res) => {
    const parsed = insertWatchlistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid watchlist entry", errors: parsed.error.flatten() });
    if (!['stock','crypto'].includes(parsed.data.kind)) return res.status(400).json({ message: "kind must be 'stock' or 'crypto'" });
    const w = await storage.addWatchlist({ ...parsed.data, symbol: parsed.data.symbol.toUpperCase() });
    res.json(w);
  });

  app.delete("/api/watchlist/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.json(await storage.removeWatchlist(id));
  });

  /* ============ Recommendations: similar to currently invested ============ */

  app.get("/api/recommendations", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    // Load portfolio source tickers
    let snapshot: any = null;
    const fileName = mode === "demo" ? "portfolio-snapshot-demo.json" : "portfolio-snapshot.json";
    const candidates = [
      join(process.cwd(), `server/data/${fileName}`),
      join(process.cwd(), `data/${fileName}`),
      join(process.cwd(), `../server/data/${fileName}`),
    ];
    for (const p of candidates) {
      try { snapshot = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
    }
    const manual = mode === "demo" ? [] : await storage.listHoldings();
    const ownedTickers = new Set<string>([
      ...((snapshot?.holdings ?? []) as any[]).map(h => (h.ticker || "").toUpperCase()),
      ...manual.map(h => h.symbol.toUpperCase()),
    ]);

    // Sector / theme map — each owned ticker suggests a peer set
    const peers: Record<string, { symbol: string; name: string; reason: string; kind: "stock" | "crypto" }[]> = {
      // semis
      NVDA: [{symbol:"AMD",name:"Advanced Micro Devices",reason:"Direct AI-GPU competitor",kind:"stock"},{symbol:"AVGO",name:"Broadcom",reason:"Custom AI silicon + networking",kind:"stock"},{symbol:"TSM",name:"TSMC",reason:"Fabs every leading-edge chip",kind:"stock"}],
      MU:   [{symbol:"WDC",name:"Western Digital",reason:"Memory \u00b7 storage cycle peer",kind:"stock"},{symbol:"SMCI",name:"Super Micro",reason:"AI server demand for memory",kind:"stock"}],
      SOXL: [{symbol:"SMH",name:"VanEck Semi ETF",reason:"Unleveraged broad semis",kind:"stock"},{symbol:"SOXX",name:"iShares Semi ETF",reason:"Sector ETF, lower volatility",kind:"stock"}],
      TSM:  [{symbol:"ASML",name:"ASML",reason:"EUV monopoly upstream of TSMC",kind:"stock"},{symbol:"AMAT",name:"Applied Materials",reason:"Wafer-fab equipment",kind:"stock"}],
      // space
      RKLB: [{symbol:"ASTS",name:"AST SpaceMobile",reason:"Space adjacency, direct-to-cell",kind:"stock"},{symbol:"LMT",name:"Lockheed Martin",reason:"Established launch + defense",kind:"stock"},{symbol:"PL",name:"Planet Labs",reason:"Satellite imagery peer",kind:"stock"}],
      ASTS: [{symbol:"RKLB",name:"Rocket Lab",reason:"Launch provider for sat constellations",kind:"stock"},{symbol:"IRDM",name:"Iridium",reason:"Established sat-to-phone",kind:"stock"}],
      // EVs
      TSLA: [{symbol:"RIVN",name:"Rivian",reason:"US EV peer",kind:"stock"},{symbol:"BYDDY",name:"BYD",reason:"Global EV leader",kind:"stock"},{symbol:"NIO",name:"NIO",reason:"China EV battery-swap model",kind:"stock"}],
      // brokerage
      IBKR: [{symbol:"SCHW",name:"Charles Schwab",reason:"Retail brokerage giant",kind:"stock"},{symbol:"HOOD",name:"Robinhood",reason:"Younger retail demo",kind:"stock"}],
      // indices
      SPY:  [{symbol:"VOO",name:"Vanguard S&P 500",reason:"Lower expense ratio S&P",kind:"stock"},{symbol:"IVV",name:"iShares Core S&P 500",reason:"S&P alternative",kind:"stock"}],
      QQQ:  [{symbol:"QQQM",name:"Invesco NASDAQ 100",reason:"Cheaper QQQ for buy-and-hold",kind:"stock"},{symbol:"XLK",name:"Tech Select Sector SPDR",reason:"Pure tech exposure",kind:"stock"}],
      VTI:  [{symbol:"ITOT",name:"iShares Core S&P Total Market",reason:"Total-market alternative",kind:"stock"}],
      // tech mega-cap
      AAPL: [{symbol:"GOOGL",name:"Alphabet",reason:"Mega-cap tech peer",kind:"stock"},{symbol:"META",name:"Meta Platforms",reason:"Mobile ad + AI infra",kind:"stock"}],
      MSFT: [{symbol:"GOOGL",name:"Alphabet",reason:"Cloud + AI competitor",kind:"stock"},{symbol:"ORCL",name:"Oracle",reason:"Enterprise + cloud",kind:"stock"}],
      // crypto
      BTC:  [{symbol:"ETH",name:"Ethereum",reason:"Largest alt; smart-contract layer",kind:"crypto"},{symbol:"IBIT",name:"iShares Bitcoin Trust",reason:"Spot BTC ETF via brokerage",kind:"stock"}],
      ETH:  [{symbol:"SOL",name:"Solana",reason:"High-throughput L1",kind:"crypto"},{symbol:"ARB",name:"Arbitrum",reason:"Eth L2 ecosystem",kind:"crypto"}],
      SOL:  [{symbol:"AVAX",name:"Avalanche",reason:"Subnet architecture L1 peer",kind:"crypto"},{symbol:"NEAR",name:"NEAR Protocol",reason:"Sharded L1",kind:"crypto"}],
    };

    const seen = new Set<string>();
    const recs: { symbol: string; name: string; reason: string; basedOn: string; kind: "stock" | "crypto" }[] = [];
    for (const t of ownedTickers) {
      const list = peers[t];
      if (!list) continue;
      for (const p of list) {
        if (ownedTickers.has(p.symbol) || seen.has(p.symbol)) continue;
        seen.add(p.symbol);
        recs.push({ ...p, basedOn: t });
        if (recs.length >= 10) break;
      }
      if (recs.length >= 10) break;
    }

    // Enrich with live price
    const stockSyms = recs.filter(r => r.kind === "stock").map(r => r.symbol);
    const cryptoSyms = recs.filter(r => r.kind === "crypto").map(r => r.symbol);
    const [sp, cp] = await Promise.all([
      stockSyms.length ? fetchStockPrices(stockSyms) : {},
      cryptoSyms.length ? fetchCryptoPrices(cryptoSyms) : {},
    ]);
    const enriched = recs.map(r => {
      const px = r.kind === "stock" ? sp[r.symbol] : cp[r.symbol.toUpperCase()];
      return { ...r, price: px?.price ?? null, dayChangePct: px?.dayChangePct ?? null };
    });
    res.json({ recommendations: enriched, basedOnTickers: Array.from(ownedTickers) });
  });

  /* ============ Bull / Bear narratives (refreshable) ============ */

  app.get("/api/bullbear", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    // Seed param for refresh — client passes Date.now() to rotate angles
    const seed = parseInt((req.query.seed as string) || `${Date.now()}`, 10) || 1;

    // Source tickers: top holdings by value (live: from snapshot, demo: from demo snapshot)
    let snapshot: any = null;
    const fileName = mode === "demo" ? "portfolio-snapshot-demo.json" : "portfolio-snapshot.json";
    for (const p of [
      join(process.cwd(), `server/data/${fileName}`),
      join(process.cwd(), `data/${fileName}`),
      join(process.cwd(), `../server/data/${fileName}`),
    ]) {
      try { snapshot = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
    }
    const manual = mode === "demo" ? [] : await storage.listHoldings();
    const allTickers: string[] = [
      ...((snapshot?.holdings ?? []) as any[]).map(h => (h.ticker || "").toUpperCase()),
      ...manual.map(h => h.symbol.toUpperCase()),
    ].filter(Boolean);
    const uniq = Array.from(new Set(allTickers));

    // Curated bull/bear angles per ticker. Multiple options so refresh rotates them.
    const angles: Record<string, { bull: string[]; bear: string[] }> = {
      NVDA: { bull: ["Data-center revenue still doubling YoY \u2014 Blackwell ramp ahead","Sovereign AI deals (Saudi, UAE) extending TAM beyond hyperscalers","CUDA moat keeps competitors on the back foot"], bear: ["Hyperscaler capex shows first signs of digestion","Custom silicon (Trainium, TPU) chips away at GPU share","Multiple compression risk \u2014 priced for perfection"] },
      MU:   { bull: ["HBM3e supply is sold out through 2026","DRAM pricing has bottomed; up-cycle pricing power returning","AI memory bandwidth needs grow faster than compute"], bear: ["Memory is cyclical \u2014 oversupply always returns","Samsung HBM qualification risks share loss","China demand exposure adds geopolitical tail risk"] },
      SOXL: { bull: ["Leveraged exposure to a structural up-cycle in semis","Compounds aggressively in trending tape","Best-performing semi vehicle YTD"], bear: ["3x daily reset = volatility drag in choppy markets","Decay makes it a trading vehicle, not a hold","Sharp drawdowns can erase months of gains"] },
      RKLB: { bull: ["Neutron medium-lift coming online \u2014 reusability story","Backlog growing across DoD and commercial","Vertical integration through Sinclair, Mynaric, etc."], bear: ["Profitability still years away","SpaceX dominance compresses unit economics","Cash burn until Neutron operational"] },
      ASTS: { bull: ["Direct-to-cell partnerships with AT&T, Verizon, Vodafone","BlueBird satellites scaling toward commercial service","Spectrum value alone may exceed market cap"], bear: ["Pre-revenue \u2014 dilution risk persists","Starlink Direct-to-Cell competing for same use case","Constellation deployment delays would reset thesis"] },
      TSLA: { bull: ["FSD V12 monetization just beginning","Energy storage business doubling annually","Robotaxi optionality not yet in numbers"], bear: ["China EV competition crushing margins","Cybertruck demand softer than expected","FSD timeline keeps slipping"] },
      TSM:  { bull: ["3nm and 2nm pricing locked in at premium","AI customers committing multi-year supply deals","Arizona fabs de-risk geopolitical concentration"], bear: ["Taiwan strait tension is a permanent overhang","Capex cycle ramping just as memory may slow","Customer concentration \u2014 Apple + NVDA dominate"] },
      IBKR: { bull: ["Active trader account growth at 20%+ annually","Tech-stack moat in pro and institutional segments","Rate income still elevated"], bear: ["Rate cuts shrink net interest spread","Robinhood encroaching on retail share","Equity valuation reflects most of the good news"] },
      SPY:  { bull: ["Earnings broadening beyond Mag 7 supports continued rally","Fed cuts likely in 2026 \u2014 multiple expansion tailwind","Historical baseline returns ~10% annualized"], bear: ["S&P P/E sits above 21x \u2014 above long-term mean","Concentration risk in top 10 names","Recession indicators (yield curve, LEI) still flashing"] },
      QQQ:  { bull: ["AI capex still in early innings for Nasdaq 100","Mega-cap balance sheets are pristine","Software margin expansion continues"], bear: ["~50% concentration in top 7 names is fragility","Tech beta amplifies any growth scare","Antitrust action against AAPL/GOOGL/META is live"] },
      VTI:  { bull: ["Broadest US exposure \u2014 lowest concept risk","Small/mid caps have lagged \u2014 catch-up trade","0.03% expense ratio compounds advantage"], bear: ["Same large-cap concentration as S&P at the top","US-only exposure misses international rotation","Index-flow distortion of underlying prices"] },
      AAPL: { bull: ["Services revenue compounding at high margin","AI features driving upgrade cycle","Buyback authorization remains massive"], bear: ["iPhone unit growth has stalled","China revenue under structural pressure","App Store under regulatory siege globally"] },
      MSFT: { bull: ["Azure AI revenue inflecting","Copilot attach rate accelerating across enterprise","OpenAI partnership compounds optionality"], bear: ["Capex intensity weighing on free cash flow","Search remains a distant second to Google","AI ROI questions starting to surface"] },
      BTC:  { bull: ["Spot ETF flows institutionalize demand","Post-halving supply shock thesis intact","Sovereign + corporate treasuries accumulating"], bear: ["Macro liquidity tightens \u2014 BTC trades as risk asset","Regulatory whiplash possible with new administrations","Mining concentration is a centralization risk"] },
      ETH:  { bull: ["L2 scaling unlocking new on-chain volume","Ultrasound-money thesis: net deflationary issuance","Restaking economies of scale forming"], bear: ["Solana eating L1 mindshare for new apps","L2 fragmentation weakens mainnet fee accrual","Regulatory classification still unresolved"] },
      SOL:  { bull: ["Real-world transactions per second leader","DePIN + meme economy = real revenue","Firedancer client coming online"], bear: ["Network outages a recurring concern","VC unlocks still ahead","Centralization tradeoff is real"] },
    };

    // Pick top 5 from owned
    const candidates = uniq.filter(t => angles[t]).slice(0, 12);
    // If not enough, fill with index/market commentary on broad names
    const fillers = ["SPY","QQQ","BTC","ETH","NVDA"].filter(t => !candidates.includes(t) && angles[t]);
    const pool = [...candidates, ...fillers].slice(0, 8);

    // Deterministic shuffle by seed
    const rng = mulberry32(seed);
    const shuffled = pool.slice().sort(() => rng() - 0.5).slice(0, 5);

    const list = shuffled.map(sym => {
      const a = angles[sym];
      const bullIdx = Math.floor(rng() * a.bull.length);
      const bearIdx = Math.floor(rng() * a.bear.length);
      return {
        symbol: sym,
        bull: a.bull[bullIdx],
        bear: a.bear[bearIdx],
      };
    });

    res.json({ items: list, asOf: new Date().toISOString(), seed });
  });

  /* ============ Market-wide movers (Yahoo predefined screeners) ============ */

  app.get("/api/market-movers", async (_req, res) => {
    try {
      const [gainersRes, losersRes] = await Promise.all([
        fetch("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=5&scrIds=day_gainers", { headers: { "User-Agent": "Mozilla/5.0" } }),
        fetch("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=5&scrIds=day_losers",  { headers: { "User-Agent": "Mozilla/5.0" } }),
      ]);
      const gJson: any = gainersRes.ok ? await gainersRes.json() : null;
      const lJson: any = losersRes.ok  ? await losersRes.json()  : null;
      const mapQuote = (q: any) => ({
        symbol: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice,
        dayChangePct: q.regularMarketChangePercent,
        dayChangeAbs: q.regularMarketChange,
        marketCap: q.marketCap,
        volume: q.regularMarketVolume,
      });
      const gainers = (gJson?.finance?.result?.[0]?.quotes ?? []).slice(0, 5).map(mapQuote);
      const losers  = (lJson?.finance?.result?.[0]?.quotes ?? []).slice(0, 5).map(mapQuote);
      res.json({ gainers, losers, asOf: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e.message, gainers: [], losers: [] });
    }
  });

  /* ============ Portfolio history (synthesized from current change deltas) ============ */

  app.get("/api/portfolio-history", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const fileName = mode === "demo" ? "portfolio-snapshot-demo.json" : "portfolio-snapshot.json";
    let snapshot: any = null;
    for (const p of [
      join(process.cwd(), `server/data/${fileName}`),
      join(process.cwd(), `data/${fileName}`),
      join(process.cwd(), `../server/data/${fileName}`),
    ]) {
      try { snapshot = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
    }
    const manual = mode === "demo" ? [] : await storage.listHoldings();
    // Combine
    const holdings = [
      ...((snapshot?.holdings ?? []) as any[]).map((h: any) => ({
        value: h.value, dayChangePct: h.dayChangePct || 0, changeMo: h.changeMo || 0, change6Mo: h.change6Mo || 0,
      })),
    ];
    // Compute portfolio value at: 6mo ago, 1mo ago, 1d ago, now.
    // Each holding: today_value = past_value * (1 + pct/100)  =>  past_value = today_value / (1 + pct/100)
    let now = holdings.reduce((s, h) => s + h.value, 0);
    let oneDay = holdings.reduce((s, h) => s + (h.value / (1 + h.dayChangePct / 100)), 0);
    let oneMo = holdings.reduce((s, h) => s + (h.value / (1 + h.changeMo / 100)), 0);
    let sixMo = holdings.reduce((s, h) => s + (h.value / (1 + h.change6Mo / 100)), 0);
    // Add manual flat (no history)
    const manualValue = manual.reduce((s, h) => s + h.quantity * h.costBasis, 0);
    now += manualValue; oneDay += manualValue; oneMo += manualValue; sixMo += manualValue;

    // Synthesize ~12 intermediate points (smooth interpolation between known anchors)
    const points: { t: string; v: number }[] = [];
    const today = new Date();
    function dateBack(days: number) {
      const d = new Date(today); d.setDate(d.getDate() - days);
      return d.toISOString().slice(0, 10);
    }
    // 6mo -> 1mo (5 months), 1mo -> 1d (29 days), 1d -> now
    const anchors: { days: number; v: number }[] = [
      { days: 180, v: sixMo },
      { days: 90,  v: sixMo + (oneMo - sixMo) * 0.6 },
      { days: 30,  v: oneMo },
      { days: 14,  v: oneMo + (oneDay - oneMo) * 0.55 },
      { days: 7,   v: oneMo + (oneDay - oneMo) * 0.78 },
      { days: 1,   v: oneDay },
      { days: 0,   v: now },
    ];
    for (const a of anchors) points.push({ t: dateBack(a.days), v: Math.round(a.v * 100) / 100 });

    res.json({
      points,
      currentValue: Math.round(now * 100) / 100,
      sixMonthReturnPct: sixMo > 0 ? ((now - sixMo) / sixMo) * 100 : 0,
      oneMonthReturnPct: oneMo > 0 ? ((now - oneMo) / oneMo) * 100 : 0,
      dayReturnPct: oneDay > 0 ? ((now - oneDay) / oneDay) * 100 : 0,
    });
  });

  /* ============ Helper: load snapshot file with fallback paths ============ */
  function loadSnapshot<T = any>(fileName: string): T | null {
    const candidates = [
      join(process.cwd(), `server/data/${fileName}`),
      join(process.cwd(), `data/${fileName}`),
      join(process.cwd(), `../server/data/${fileName}`),
    ];
    for (const p of candidates) {
      try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch {}
    }
    return null;
  }

  /* ============ Concerts for you (Spotify × Ticketmaster) ============ */
  app.get("/api/concerts-for-you", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const city = (req.query.city as string | undefined)?.trim() || (mode === "demo" ? "Los Angeles" : "Honolulu");

    // Build artist list. Live mode: prefer real Spotify (followed + recently-played + top). Demo: snapshot.
    const seen = new Set<string>();
    const artists: string[] = [];
    const pushArtist = (name: string) => {
      const primary = (name || "").split(",")[0].trim();
      if (primary && !seen.has(primary.toLowerCase())) {
        seen.add(primary.toLowerCase());
        artists.push(primary);
      }
    };

    let basisLabel = "In your Spotify rotation";
    if (mode === "live") {
      const st = await Spotify.status().catch(() => ({ authorized: false } as any));
      if (st.authorized) {
        try {
          const [followed, recent, top] = await Promise.all([
            Spotify.getFollowedArtists(20).catch(() => []),
            Spotify.getRecentlyPlayed(20).catch(() => ({ tracks: [] as any[] })),
            Spotify.getTopTracks("short_term", 20).catch(() => ({ tracks: [] as any[] })),
          ]);
          for (const a of followed) pushArtist(a.name);
          for (const t of (recent as any).tracks || []) pushArtist(t.artist);
          for (const t of (top as any).tracks || []) pushArtist(t.artist);
          basisLabel = "Followed or recently played on Spotify";
        } catch {}
      }
      // Also include user-pinned "artist" items
      const pinnedArtists = await storage.listUserItems("artist").catch(() => []);
      for (const p of pinnedArtists) pushArtist(p.title);
    }

    // Fallback to snapshot if we still have no artists (or in demo mode)
    if (artists.length === 0) {
      const fileName = mode === "demo" ? "music-snapshot-demo.json" : "music-snapshot.json";
      const snap = loadSnapshot<any>(fileName);
      if (snap && Array.isArray(snap.tracks)) {
        for (const t of snap.tracks) pushArtist(t.artist || "");
      }
    }
    if (artists.length === 0) return res.json({ source: "none", city, concerts: [] });

    if (!TM_KEY) {
      // Provide a synthetic demo set
      const concerts = artists.slice(0, 6).map((a, i) => ({
        artist: a,
        venue: i % 2 === 0 ? "Republik" : "The Republik",
        city,
        date: new Date(Date.now() + (14 + i * 11) * 86400000).toISOString().slice(0, 10),
        url: `https://www.ticketmaster.com/search?q=${encodeURIComponent(a)}`,
        basedOn: basisLabel,
      }));
      return res.json({ source: "synth", city, concerts });
    }

    const concerts: any[] = [];
    // Limit to 8 artists to avoid rate limits
    for (const a of artists.slice(0, 10)) {
      try {
        const data = await tmFetch({ size: "3", keyword: a, city, sort: "date,asc" });
        const events: any[] = data?._embedded?.events ?? [];
        for (const e of events) {
          concerts.push({
            artist: a,
            name: e.name,
            venue: e._embedded?.venues?.[0]?.name || "",
            city: e._embedded?.venues?.[0]?.city?.name || city,
            date: e.dates?.start?.localDate || "",
            url: e.url,
            basedOn: `${a} — ${basisLabel.toLowerCase()}`,
          });
          if (concerts.length >= 12) break;
        }
      } catch {}
      if (concerts.length >= 12) break;
    }

    // Fallback: if no artist-matched events, fetch generic concerts/music events in the city
    if (concerts.length === 0) {
      try {
        const data = await tmFetch({ size: "10", city, classificationName: "music", sort: "date,asc" });
        const events: any[] = data?._embedded?.events ?? [];
        for (const e of events) {
          concerts.push({
            artist: e.name?.split(" at ")[0] || e.name,
            name: e.name,
            venue: e._embedded?.venues?.[0]?.name || "",
            city: e._embedded?.venues?.[0]?.city?.name || city,
            date: e.dates?.start?.localDate || "",
            url: e.url,
            basedOn: `Music event near you`,
          });
        }
      } catch {}
    }

    const { items: ranked, learning } = await rerankWithFeedback(
      concerts,
      "concert",
      (c: any) => `${c.artist || c.name}-${c.date || ""}`,
      (c: any) => `${c.artist || ""} ${c.name || ""} ${c.venue || ""}`,
    );
    res.json({ source: "ticketmaster", city, concerts: ranked, learning });
  });

  /* ============ Listening history (decade drift from real Spotify, or snapshot in demo) ============ */
  app.get("/api/listening-history", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    let tracks: any[] = [];
    let sourceLabel = mode;

    if (mode === "live") {
      const st = await Spotify.status().catch(() => ({ authorized: false } as any));
      if (st.authorized) {
        try {
          const [recent, top] = await Promise.all([
            Spotify.getRecentlyPlayed(50),
            Spotify.getTopTracks("medium_term", 50),
          ]);
          // Dedupe by id
          const byId = new Map<string, any>();
          for (const t of recent.tracks) byId.set(t.id, t);
          for (const t of top.tracks) if (!byId.has(t.id)) byId.set(t.id, t);
          tracks = Array.from(byId.values());
          sourceLabel = "spotify-live";
        } catch {}
      }
    }

    if (tracks.length === 0 && mode === "demo") {
      const snap = loadSnapshot<any>("music-snapshot-demo.json");
      if (snap && Array.isArray(snap.tracks)) {
        tracks = snap.tracks;
        sourceLabel = snap.source || mode;
      }
    }
    if (tracks.length === 0) return res.json({ source: "none", buckets: [], topArtists: [] });

    const decadeMap = new Map<string, number>();
    const artistMap = new Map<string, number>();
    for (const t of tracks) {
      const yr = parseInt(String(t.releaseDate || "").slice(0, 4), 10);
      if (yr > 1900 && yr < 2100) {
        const decade = `${Math.floor(yr / 10) * 10}s`;
        decadeMap.set(decade, (decadeMap.get(decade) || 0) + 1);
      }
      const primary = (t.artist || "").split(",")[0].trim();
      if (primary) artistMap.set(primary, (artistMap.get(primary) || 0) + 1);
    }
    const buckets = Array.from(decadeMap.entries())
      .map(([decade, count]) => ({ decade, count }))
      .sort((a, b) => a.decade.localeCompare(b.decade));
    const topArtists = Array.from(artistMap.entries())
      .map(([artist, count]) => ({ artist, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    res.json({ source: sourceLabel, buckets, topArtists, total: tracks.length });
  });

  /* ============ Food spots (curated + OSM + manual) ============ */
  const CURATED_FOOD: any[] = [
    { name: "Helena's Hawaiian Food", city: "Honolulu", category: "Hawaiian", note: "James Beard classic — kalua pig + pipikaula", url: "https://helenashawaiianfood.com", source: "curated" },
    { name: "Marugame Udon", city: "Honolulu", category: "Japanese", note: "Hand-pulled udon, cheap and fast", url: "", source: "curated" },
    { name: "Side Street Inn", city: "Honolulu", category: "Local", note: "Pork chops, fried rice — local institution", url: "https://sidestreetinn.com", source: "curated" },
    { name: "Mud Hen Water", city: "Honolulu", category: "New Hawaiian", note: "Chef Ed Kenney — seasonal island ingredients", url: "https://mudhenwater.com", source: "curated" },
    { name: "Off The Hook Poke", city: "Honolulu", category: "Poke", note: "Manoa Marketplace — best poke bowls on the island", url: "", source: "curated" },
    { name: "Leonard's Bakery", city: "Honolulu", category: "Bakery", note: "Original malasadas since 1952", url: "https://leonardshawaii.com", source: "curated" },
    { name: "Ono Seafood", city: "Honolulu", category: "Poke", note: "Kapahulu staple — fresh ahi by the pound", url: "", source: "curated" },
    { name: "Liliha Bakery", city: "Honolulu", category: "Bakery", note: "Coco puffs and old-school diner counter", url: "https://lilihabakery.com", source: "curated" },
    { name: "Buho Cocina y Cantina", city: "Honolulu", category: "Mexican", note: "Rooftop tacos in Waikiki", url: "", source: "curated" },
    { name: "The Pig and The Lady", city: "Honolulu", category: "Vietnamese", note: "Chinatown — modern Vietnamese tasting menu", url: "https://thepigandthelady.com", source: "curated" },
  ];
  const CURATED_FOOD_DEMO: any[] = [
    { name: "Bestia", city: "Los Angeles", category: "Italian", note: "Arts District — handmade pasta, blistered pizza", url: "https://bestiala.com", source: "curated" },
    { name: "Guelaguetza", city: "Los Angeles", category: "Mexican", note: "James Beard winner — mole negro", url: "https://ilovemole.com", source: "curated" },
    { name: "Republique", city: "Los Angeles", category: "French", note: "Brunch + bakery in historic Mid-City space", url: "https://republiquela.com", source: "curated" },
    { name: "Sushi Gen", city: "Los Angeles", category: "Japanese", note: "Little Tokyo sashimi lunch special", url: "", source: "curated" },
    { name: "Howlin' Ray's", city: "Los Angeles", category: "Nashville Hot", note: "Chinatown — expect a line", url: "https://www.howlinrays.com", source: "curated" },
    { name: "Pizzana", city: "Los Angeles", category: "Pizza", note: "Neo-Neapolitan — Brentwood + WeHo", url: "", source: "curated" },
  ];

  app.get("/api/food-spots", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const q = (req.query.q as string | undefined)?.trim() || "";
    const city = (req.query.city as string | undefined)?.trim() || (mode === "demo" ? "Los Angeles" : "Honolulu");
    const source = (req.query.source as string | undefined)?.trim();

    // 1) Curated (in-memory)
    const curatedAll = mode === "demo" ? CURATED_FOOD_DEMO : CURATED_FOOD;
    let curated = curatedAll.filter(c => c.city.toLowerCase().includes(city.toLowerCase()));
    if (q) curated = curated.filter(c =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.category || "").toLowerCase().includes(q.toLowerCase()) ||
      (c.note || "").toLowerCase().includes(q.toLowerCase())
    );

    // 2) Manual + 3) OSM (stored in same table by source field)
    const stored = await storage.listFoodSpots({ city, query: q || undefined });
    const manual = stored.filter(s => s.source === "manual");
    const osm = stored.filter(s => s.source === "osm");

    const showAll = !source || source === "all";
    let results: any[] = [];
    if (showAll || source === "curated") results = results.concat(curated);
    if (showAll || source === "manual") results = results.concat(manual);
    if (showAll || source === "osm") results = results.concat(osm);

    res.json({ city, query: q, count: results.length, results });
  });

  app.post("/api/food-spots", async (req, res) => {
    try {
      const parsed = insertFoodSpotSchema.parse(req.body);
      const row = await storage.addFoodSpot(parsed);
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/food-spots/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const r = await storage.removeFoodSpot(id);
    res.json(r);
  });

  // OSM/Overpass — fetch nearby restaurants and offer them for the user to save
  app.get("/api/food-spots/osm", async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
    // Simple Overpass query: amenity=restaurant within an area named city
    const query = `[out:json][timeout:25];\narea[name="${city}"]->.a;\n(node["amenity"~"restaurant|cafe|bar"](area.a);)\n;out center 30;`;
    try {
      const r = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
        headers: { "Content-Type": "text/plain" },
      });
      if (!r.ok) return res.json({ city, results: [] });
      const data = await r.json();
      const results = (data.elements || []).slice(0, 30).map((el: any) => ({
        name: el.tags?.name || "Unnamed",
        city,
        category: el.tags?.cuisine || el.tags?.amenity || "",
        note: el.tags?.["addr:street"] ? `${el.tags["addr:housenumber"] || ""} ${el.tags["addr:street"]}`.trim() : "",
        url: el.tags?.website || "",
        source: "osm",
      })).filter((x: any) => x.name !== "Unnamed");
      res.json({ city, results });
    } catch (e: any) {
      res.json({ city, results: [], error: e.message });
    }
  });

  /* ============ Subscriptions (manual + auto-detected) ============ */
  app.get("/api/subscriptions", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const fileName = mode === "demo" ? "transactions-snapshot-demo.json" : "transactions-snapshot.json";
    const snap = loadSnapshot<any>(fileName);

    // Auto-detect: group transactions by merchant, find recurring monthly
    const detected: any[] = [];
    if (snap?.transactions) {
      const byMerchant = new Map<string, { dates: string[]; amounts: number[]; category: string }>();
      for (const t of snap.transactions) {
        if (t.category !== "Subscription") continue;
        const entry = byMerchant.get(t.merchant) || { dates: [], amounts: [], category: t.category };
        entry.dates.push(t.date);
        entry.amounts.push(t.amount);
        byMerchant.set(t.merchant, entry);
      }
      for (const [merchant, info] of byMerchant) {
        if (info.dates.length >= 2) {
          // Compute average gap in days
          const sorted = info.dates.slice().sort();
          const gaps: number[] = [];
          for (let i = 1; i < sorted.length; i++) {
            gaps.push((new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 86400000);
          }
          const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          const cadence = avgGap >= 25 && avgGap <= 35 ? "monthly" : avgGap >= 6 && avgGap <= 8 ? "weekly" : avgGap >= 350 ? "yearly" : "monthly";
          const avgAmount = info.amounts.reduce((a, b) => a + b, 0) / info.amounts.length;
          // Project next charge
          const lastDate = new Date(sorted[sorted.length - 1]);
          const next = new Date(lastDate.getTime() + avgGap * 86400000);
          detected.push({
            id: `detected-${merchant.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            name: merchant,
            amount: Math.round(avgAmount * 100) / 100,
            cadence,
            category: info.category,
            source: "detected",
            nextCharge: next.toISOString().slice(0, 10),
            basedOn: `${info.dates.length} charges over ${Math.round((new Date(sorted[sorted.length - 1]).getTime() - new Date(sorted[0]).getTime()) / 86400000)} days`,
          });
        }
      }
    }
    const manual = await storage.listSubscriptions();
    const totalMonthly = [...detected, ...manual].reduce((s, x) => {
      if (x.cadence === "monthly") return s + x.amount;
      if (x.cadence === "yearly") return s + x.amount / 12;
      if (x.cadence === "weekly") return s + x.amount * 4.33;
      return s;
    }, 0);
    res.json({
      detected,
      manual,
      all: [...detected, ...manual],
      totalMonthly: Math.round(totalMonthly * 100) / 100,
    });
  });

  app.post("/api/subscriptions", async (req, res) => {
    try {
      const parsed = insertSubscriptionSchema.parse(req.body);
      const row = await storage.addSubscription(parsed);
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/subscriptions/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const r = await storage.removeSubscription(id);
    res.json(r);
  });

  /* ============ Rec feedback (👍 / 👎) ============ */
  app.get("/api/rec-feedback", async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const rows = await storage.listRecFeedback(kind);
    res.json(rows);
  });

  app.post("/api/rec-feedback", async (req, res) => {
    try {
      const parsed = insertRecFeedbackSchema.parse(req.body);
      const row = await storage.upsertRecFeedback(parsed);
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/rec-feedback/:kind/:externalId", async (req, res) => {
    const r = await storage.removeRecFeedback(req.params.kind, req.params.externalId);
    res.json(r);
  });

  /* ============ Travel guide (sights, neighborhoods, day trips) ============ */
  type TravelGuide = {
    city: string;
    sights: { name: string; note: string; url?: string }[];
    neighborhoods: { name: string; note: string }[];
    dayTrips: { name: string; note: string; distance?: string }[];
  };

  const CURATED_GUIDES: Record<string, TravelGuide> = {
    "honolulu": {
      city: "Honolulu",
      sights: [
        { name: "Diamond Head Crater", note: "Sunrise hike with the city + south-shore reefs spread below", url: "https://gostateparks.hawaii.gov/diamondhead" },
        { name: "Pearl Harbor / USS Arizona", note: "Sobering memorial; reserve free tickets in advance", url: "https://www.nps.gov/perl" },
        { name: "Bishop Museum", note: "State museum of Hawaiian + Pacific culture\u2014the deep history of the islands", url: "https://www.bishopmuseum.org" },
        { name: "Lanikai Pillbox Hike", note: "Short, steep climb to a turquoise overlook on the windward side", url: "" },
        { name: "Waikiki Beach", note: "Touristy but iconic\u2014best at dawn before the crowds", url: "" },
        { name: "Iolani Palace", note: "Only royal palace on US soil; tour the throne room and basement gallery", url: "https://www.iolanipalace.org" },
      ],
      neighborhoods: [
        { name: "Kakaako", note: "Street art, breweries, design-forward cafes\u2014the warehouse district reborn" },
        { name: "Chinatown", note: "Morning markets, evening cocktails, galleries between" },
        { name: "Kaimuki", note: "Foodie strip on Waialae Ave\u2014ramen, wine bars, indie shops" },
        { name: "Manoa", note: "University vibe, lush valley, the gentle rainforest hike to the falls" },
        { name: "Kailua", note: "Windward laid-back side; bakery, paddle boards, soft-sand beaches" },
      ],
      dayTrips: [
        { name: "North Shore (Haleiwa, Sunset, Pipe)", note: "Shrimp trucks, surf spectatorship, Waimea Bay", distance: "~1h drive" },
        { name: "Kualoa Ranch", note: "Movie-set valleys; ATV, horseback, ziplines", distance: "~45m" },
        { name: "Hanauma Bay", note: "Reserved snorkeling reef\u2014reservation required, opens 6:45am", distance: "~25m" },
        { name: "Manoa Falls", note: "Half-day rainforest hike\u2014muddy after rain", distance: "~20m" },
      ],
    },
    "los angeles": {
      city: "Los Angeles",
      sights: [
        { name: "Griffith Observatory", note: "Skyline + Hollywood sign + planetarium; sunset is the move", url: "https://griffithobservatory.org" },
        { name: "The Getty Center", note: "Free hilltop museum with Brentwood views", url: "https://www.getty.edu" },
        { name: "LACMA + Petersen", note: "Mid-Wilshire museum corridor; the lamps shot at LACMA" },
        { name: "Walt Disney Concert Hall", note: "Frank Gehry steel sails; free self-guided tours", url: "" },
        { name: "Venice Boardwalk", note: "Skate culture, muscle beach, weekend chaos", url: "" },
      ],
      neighborhoods: [
        { name: "Silver Lake", note: "Cafes, vintage, the reservoir loop" },
        { name: "Arts District", note: "Breweries, lofts, weekend gallery walks" },
        { name: "Highland Park", note: "York Blvd + Figueroa; the new eastside hub" },
        { name: "Abbot Kinney (Venice)", note: "First Fridays, boutiques, the patio bars" },
      ],
      dayTrips: [
        { name: "Joshua Tree", note: "Boulders, sunset glow, Pioneertown saloon at night", distance: "~2h30" },
        { name: "Malibu / PCH", note: "El Matador beach + canyon hikes", distance: "~45m" },
        { name: "Big Bear", note: "Mountain lake; ski in winter, kayak in summer", distance: "~2h" },
      ],
    },
    "new york": {
      city: "New York",
      sights: [
        { name: "The Met", note: "Pay-what-you-can for NY residents; allow half a day minimum", url: "https://www.metmuseum.org" },
        { name: "Brooklyn Bridge walk", note: "Manhattan-to-Dumbo at sunset\u2014avoid noon crowds", url: "" },
        { name: "High Line", note: "Elevated park threading the west side, Chelsea Market exits", url: "https://www.thehighline.org" },
        { name: "Top of the Rock", note: "Better Manhattan view than the Empire (because it includes it)", url: "" },
        { name: "Whitney Museum", note: "American art with terraces overlooking the Hudson", url: "https://whitney.org" },
      ],
      neighborhoods: [
        { name: "West Village", note: "Cobblestones, brownstones, the prettiest wander in the city" },
        { name: "Williamsburg", note: "Crossing the bridge for restaurants and waterfront views" },
        { name: "Lower East Side", note: "Music venues, dive bars, the late-night corridor" },
        { name: "Harlem", note: "Apollo, jazz, the soul-food belt on 125th" },
      ],
      dayTrips: [
        { name: "Hudson Valley (Beacon, Cold Spring)", note: "Dia:Beacon + hill hikes, train from Grand Central", distance: "~1h30 train" },
        { name: "Storm King Art Center", note: "500-acre sculpture park; rent a bike on site", distance: "~1h45" },
        { name: "Long Beach / Rockaways", note: "Subway-accessible beach day in summer", distance: "~1h" },
      ],
    },
    "san francisco": {
      city: "San Francisco",
      sights: [
        { name: "Golden Gate Bridge (Battery Spencer)", note: "Best photo angle is the Marin side", url: "" },
        { name: "Alcatraz Island", note: "Book weeks ahead; the night tour is best", url: "https://www.nps.gov/alca" },
        { name: "Lands End trail", note: "Coast walk past shipwrecks to the Sutro Baths ruins", url: "" },
        { name: "SFMOMA", note: "Modern + contemporary; the rooftop sculpture garden", url: "https://www.sfmoma.org" },
      ],
      neighborhoods: [
        { name: "Mission", note: "Burritos, murals, Dolores Park hangs" },
        { name: "Hayes Valley", note: "Design boutiques + the symphony block" },
        { name: "North Beach", note: "Old Italian SF; City Lights bookstore, Saints Peter & Paul" },
      ],
      dayTrips: [
        { name: "Muir Woods + Stinson Beach", note: "Redwoods then ocean; reserve parking", distance: "~45m" },
        { name: "Napa / Sonoma", note: "Wine country day; pick one valley", distance: "~1h30" },
        { name: "Half Moon Bay", note: "Coast highway south\u2014Mavericks lookout, pumpkin patch in fall", distance: "~45m" },
      ],
    },
    "tokyo": {
      city: "Tokyo",
      sights: [
        { name: "Senso-ji + Asakusa", note: "Tokyo\u2019s oldest temple\u2014arrive early, walk Nakamise street", url: "" },
        { name: "TeamLab Planets", note: "Immersive art\u2014book a timed slot weeks ahead", url: "https://www.teamlab.art/e/planets" },
        { name: "Shibuya Sky", note: "Open-air rooftop deck over the famous scramble", url: "" },
        { name: "Meiji Shrine", note: "Forested calm in the middle of Harajuku chaos", url: "" },
      ],
      neighborhoods: [
        { name: "Shimokitazawa", note: "Indie shops, used vinyl, narrow-alley cafes" },
        { name: "Shibuya / Harajuku", note: "Fashion + crowds + the famous scramble" },
        { name: "Yanaka", note: "Old-Tokyo backstreets; cats, temples, slow afternoons" },
        { name: "Daikanyama", note: "Tsutaya bookstore + sleek design block" },
      ],
      dayTrips: [
        { name: "Kamakura", note: "Great Buddha + coast + temple hike", distance: "~1h train" },
        { name: "Hakone", note: "Onsen, Mt. Fuji views (weather permitting)", distance: "~1h30" },
        { name: "Nikko", note: "World Heritage shrines in the mountains", distance: "~2h" },
      ],
    },
  };

  function genericGuide(city: string): TravelGuide {
    return {
      city,
      sights: [
        { name: `Old town \/ historic center`, note: `Start in ${city}\u2019s oldest district\u2014the architectural anchor of the city.` },
        { name: `Main museum`, note: `Every major city has one definitive museum. Search "${city} art museum" and start there.` },
        { name: `Iconic viewpoint`, note: `Find the elevated viewpoint locals send tourists to\u2014usually a hill, tower, or rooftop.` },
      ],
      neighborhoods: [
        { name: `Downtown core`, note: `Walkable city center\u2014cafes, shopping, the central park or plaza.` },
        { name: `Creative district`, note: `Galleries, breweries, repurposed industrial buildings.` },
        { name: `Residential village`, note: `Quieter streets, neighborhood cafes, parks\u2014where locals actually live.` },
      ],
      dayTrips: [
        { name: `Nearest natural escape`, note: `Search for the closest national / state park or beach within ~1h.` },
        { name: `Smaller town nearby`, note: `Every metro has a charming small town 30-60min out for a slow-paced day.` },
      ],
    };
  }

  app.get("/api/travel-guide", async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
    const key = city.toLowerCase();
    const guide = CURATED_GUIDES[key] || genericGuide(city);
    const curated = !!CURATED_GUIDES[key];

    // Merge in user-pinned places (any city) at the top of sights
    try {
      const pinned = await storage.listUserItems("place");
      const pinnedSights = pinned.map(p => ({
        name: p.title,
        note: p.subtitle || "Added by you",
        url: p.url || undefined,
        pinned: true,
        userItemId: p.id,
      }));
      const merged = { ...guide, sights: [...pinnedSights, ...guide.sights] };
      return res.json({ ...merged, curated });
    } catch {
      return res.json({ ...guide, curated });
    }
  });

  /* Cultural / seasonal events for a city via Ticketmaster (broader than concerts) */
  app.get("/api/places-events", async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
    if (!TM_KEY) return res.json({ source: "none", city, events: [] });
    try {
      const data = await tmFetch({ size: "15", city, sort: "date,asc" });
      const events: any[] = data?._embedded?.events ?? [];
      const out = events.map((e: any) => ({
        name: e.name,
        venue: e._embedded?.venues?.[0]?.name || "",
        city: e._embedded?.venues?.[0]?.city?.name || city,
        date: e.dates?.start?.localDate || "",
        category: (() => {
          const c = e.classifications?.[0];
          const seg = c?.segment?.name;
          const gen = c?.genre?.name;
          const sub = c?.subGenre?.name;
          const pick = [seg, gen, sub].find(
            (x) => x && x !== "Undefined" && x !== "Miscellaneous"
          );
          return pick || "";
        })(),
        url: e.url,
      }));
      const { items: ranked, learning } = await rerankWithFeedback(
        out,
        "event",
        (ev: any) => `evt:${city}:${ev.name}`,
        (ev: any) => `${ev.name} ${ev.venue} ${ev.category}`,
      );
      res.json({ source: "ticketmaster", city, events: ranked, learning });
    } catch {
      res.json({ source: "ticketmaster", city, events: [] });
    }
  });

  /* ============ Bookmarks (reuses ratings table with signal=0) ============ */
  app.get("/api/bookmarks", async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const all = await storage.listRatings(kind);
    res.json({ bookmarks: all.filter((r) => r.signal === 0) });
  });

  app.post("/api/bookmarks", async (req, res) => {
    try {
      const { kind, externalId, title, meta } = req.body || {};
      if (!kind || !externalId || !title) return res.status(400).json({ message: "kind, externalId, title required" });
      const row = await storage.upsertRating({
        kind,
        externalId,
        title,
        signal: 0,
        meta: meta ? (typeof meta === "string" ? meta : JSON.stringify(meta)) : null,
      });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/bookmarks/:kind/:externalId", async (req, res) => {
    const r = await storage.removeRating(req.params.kind, decodeURIComponent(req.params.externalId));
    res.json(r);
  });

  /* ============ Finance insights (advisory) ============ */
  app.get("/api/finance-insights", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    try {
      // Fetch portfolio from our own endpoint logic by reading the snapshot file directly
      const fileName = mode === "demo" ? "portfolio-snapshot-demo.json" : "portfolio-snapshot.json";
      const candidates = [
        join(process.cwd(), `server/data/${fileName}`),
        join(process.cwd(), `data/${fileName}`),
        join(process.cwd(), `../server/data/${fileName}`),
      ];
      let portfolio: any = null;
      for (const p of candidates) {
        try { portfolio = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
      }
      if (!portfolio) return res.json({ insights: [] });

      const holdings: any[] = portfolio.holdings || portfolio.plaid?.holdings || [];
      const totalValue = Number(
        portfolio.totalValue || portfolio.plaid?.totalValue || holdings.reduce((s, h) => s + (h.value || 0), 0),
      ) || 0;
      const insights: Array<{ kind: string; severity: "info" | "watch" | "alert"; title: string; detail: string }> = [];

      // 1) Concentration risk — any position >20% of portfolio
      const sorted = [...holdings].sort((a, b) => (b.value || 0) - (a.value || 0));
      for (const h of sorted.slice(0, 3)) {
        const pct = totalValue > 0 ? ((h.value || 0) / totalValue) * 100 : 0;
        if (pct >= 12) {
          insights.push({
            kind: "concentration",
            severity: pct >= 25 ? "alert" : pct >= 18 ? "watch" : "info",
            title: `${h.ticker} is ${pct.toFixed(1)}% of your portfolio`,
            detail: `${h.name || h.ticker} at $${(h.value || 0).toFixed(0)}. Single-stock concentration above 20% raises idiosyncratic risk.`,
          });
        }
      }

      // 2) Top movers today inside YOUR portfolio (not the market)
      const movers = [...holdings]
        .filter((h) => Math.abs(h.dayChangePct || 0) >= 3 && (h.value || 0) >= 10)
        .sort((a, b) => Math.abs(b.dayChangePct || 0) - Math.abs(a.dayChangePct || 0))
        .slice(0, 3);
      for (const m of movers) {
        const up = (m.dayChangePct || 0) > 0;
        insights.push({
          kind: "mover",
          severity: "info",
          title: `${m.ticker} ${up ? "+" : ""}${(m.dayChangePct || 0).toFixed(1)}% today`,
          detail: `${m.name || m.ticker} — ${up ? "moved up" : "pulled back"} on a position worth $${(m.value || 0).toFixed(0)}.`,
        });
      }

      // 3) Losers — positions deep in the red
      const losers = [...holdings]
        .filter((h) => (h.gainPct || 0) <= -50 && (h.value || 0) >= 50)
        .sort((a, b) => (a.gainPct || 0) - (b.gainPct || 0))
        .slice(0, 2);
      for (const l of losers) {
        insights.push({
          kind: "loser",
          severity: "watch",
          title: `${l.ticker} is down ${Math.round(l.gainPct || 0)}% on cost`,
          detail: `Currently $${(l.value || 0).toFixed(0)} vs cost basis $${(l.costBasis || 0).toFixed(0)}. Consider tax-loss harvesting if you're done waiting.`,
        });
      }

      // 4) Subscriptions vs portfolio yield
      const subs = await storage.listSubscriptions().catch(() => [] as any[]);
      const monthlySubs = subs.reduce((s, x) => s + (x.cadence === "yearly" ? (x.amount || 0) / 12 : x.cadence === "weekly" ? (x.amount || 0) * 4.33 : (x.amount || 0)), 0);
      if (monthlySubs > 0 && totalValue > 0) {
        // Approx yield to cover subs: monthlySubs * 12 / totalValue
        const yieldNeeded = ((monthlySubs * 12) / totalValue) * 100;
        insights.push({
          kind: "sub-yield",
          severity: yieldNeeded > 8 ? "watch" : "info",
          title: `Subscriptions cost ${yieldNeeded.toFixed(1)}% of portfolio per year`,
          detail: `$${monthlySubs.toFixed(2)}/mo × 12 = $${(monthlySubs * 12).toFixed(0)}/yr. Your portfolio would need a ${yieldNeeded.toFixed(1)}% return just to cover them.`,
        });
      }

      // 5) Dust positions — worth almost nothing, cluttering view
      const dust = holdings.filter((h) => (h.value || 0) < 1 && (h.value || 0) > 0).length;
      if (dust >= 5) {
        insights.push({
          kind: "dust",
          severity: "info",
          title: `${dust} dust positions under $1`,
          detail: `Tiny fractional holdings (likely from a round-up app) add clutter without exposure. Consider consolidating.`,
        });
      }

      res.json({ asOf: portfolio.asOf || new Date().toISOString(), totalValue, insights });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============ Price helpers (Yahoo + CoinGecko) ============ */

async function fetchStockPrices(symbols: string[]): Promise<Record<string, { price: number; dayChangePct: number; name?: string }>> {
  const out: Record<string, any> = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=2d&interval=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!r.ok) return;
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return;
      out[sym] = {
        price: meta.regularMarketPrice,
        dayChangePct: meta.regularMarketPrice && meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : 0,
        name: meta.longName || meta.shortName || sym,
      };
    } catch {}
  }));
  return out;
}

async function fetchCryptoPrices(symbols: string[]): Promise<Record<string, { price: number; dayChangePct: number; name?: string }>> {
  const map: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", AVAX: "avalanche-2", MATIC: "matic-network", LINK: "chainlink", DOT: "polkadot", LTC: "litecoin", BCH: "bitcoin-cash", UNI: "uniswap", AAVE: "aave", ATOM: "cosmos", NEAR: "near", APT: "aptos", SUI: "sui", ARB: "arbitrum", OP: "optimism" };
  const ids = symbols.map(s => map[s.toUpperCase()]).filter(Boolean);
  if (!ids.length) return {};
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    if (!r.ok) return {};
    const data = await r.json();
    const out: Record<string, any> = {};
    for (const sym of symbols) {
      const id = map[sym.toUpperCase()];
      if (id && data[id]) {
        out[sym.toUpperCase()] = {
          price: data[id].usd,
          dayChangePct: data[id].usd_24h_change || 0,
          name: sym.toUpperCase(),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}
