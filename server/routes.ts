import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storage } from "./storage";
import { insertRatingSchema, insertHoldingSchema, insertWatchlistSchema, insertSubscriptionSchema, insertFoodSpotSchema, insertRecFeedbackSchema, insertUserItemSchema } from "@shared/schema";
import * as Spotify from "./spotify";
import * as Plaid from "./plaid";
import { seedCatalog, type CatalogItem } from "./catalog-seed";
import { seedEvents, type SeedEvent } from "./events-seed";
import { requireAuth, optionalAuth, setSessionCookie, clearSessionCookie } from "./auth";
import { randomUUID } from "node:crypto";

const TMDB_KEY = process.env.TMDB_API_KEY;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

// In-memory state store for Spotify OAuth (state param → timestamp)
const pendingStates = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v > 10 * 60 * 1000) pendingStates.delete(k); // 10min TTL
  }
}, 60_000);

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

async function rerankWithFeedback<T>(
  items: T[],
  userId: number,
  kind: string,
  idFn: (it: T) => string,
  textFn: (it: T) => string,
): Promise<{ items: T[]; learning: { dropped: number; boosted: number; basis: string[] } }> {
  let feedback: { externalId: string; signal: number }[] = [];
  try {
    feedback = (await storage.listRecFeedback(userId, kind)) as any;
  } catch {
    return { items, learning: { dropped: 0, boosted: 0, basis: [] } };
  }
  if (!feedback.length) return { items, learning: { dropped: 0, boosted: 0, basis: [] } };

  const upIds = new Set(feedback.filter((f) => f.signal === 1).map((f) => f.externalId));
  const downIds = new Set(feedback.filter((f) => f.signal === -1).map((f) => f.externalId));

  const likedTokens = new Set<string>();
  for (const it of items) {
    if (upIds.has(idFn(it))) {
      for (const tok of tokenize(textFn(it))) likedTokens.add(tok);
    }
  }
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
      let score = -idx;
      if (upIds.has(idFn(it))) { score += 1000; boosted++; }
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

// Helper: load snapshot file
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

/* ------------ routes ------------ */

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ══════════════════════════════════════════════════════════════════════════
  // Auth — Spotify OAuth as login
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/auth/spotify/login", (_req, res) => {
    const cfg = Spotify.getAppConfig();
    if (!cfg) {
      return res.status(500).json({ error: "Spotify not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET." });
    }
    const state = randomUUID();
    pendingStates.set(state, Date.now());
    const url = Spotify.buildAuthorizeUrl(state);
    res.redirect(url);
  });

  app.get("/api/auth/spotify/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const err = req.query.error as string | undefined;

    if (err) return res.status(400).send(`Spotify authorization denied: ${err}`);
    if (!code) return res.status(400).send("Missing authorization code");
    if (!state || !pendingStates.has(state)) {
      return res.status(400).send("Invalid or expired state parameter");
    }
    pendingStates.delete(state);

    try {
      const tok = await Spotify.exchangeCodeForToken(code);
      const profile = await Spotify.getMe(tok.access_token);

      // Find or create user
      let user = await storage.getUserBySpotifyId(profile.id);
      if (!user) {
        user = await storage.createUser({
          spotifyId: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          avatarUrl: profile.images?.[0]?.url,
        });
      }

      // Save refresh token per user
      if (tok.refresh_token) {
        await Spotify.saveUserRefreshToken(user.id, tok.refresh_token);
      }

      // Create session + set cookie
      const session = await storage.createSession(user.id);
      setSessionCookie(res, session.id, session.expiresAt);

      res.redirect("/#/");
    } catch (e: any) {
      console.error("[spotify-callback]", e.message);
      res.status(500).send(`Authentication failed: ${e.message}`);
    }
  });

  app.get("/api/auth/me", optionalAuth, (req, res) => {
    if (!req.user) return res.json({ user: null });
    const { id, displayName, email, avatarUrl, spotifyId, createdAt } = req.user;
    res.json({ user: { id, displayName, email, avatarUrl, spotifyId, createdAt } });
  });

  app.post("/api/auth/logout", optionalAuth, async (req, res) => {
    const sid = req.cookies?.sid as string | undefined;
    if (sid) await storage.deleteSession(sid);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Plaid
  // ══════════════════════════════════════════════════════════════════════════

  app.post("/api/plaid/link-token", requireAuth, async (req, res) => {
    try {
      const linkToken = await Plaid.createLinkToken(req.user!.id);
      res.json({ linkToken });
    } catch (e: any) {
      if (e.name === "PlaidNotConfiguredError") return res.status(503).json({ error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // Return the in-flight link_token for this user so the client can
  // re-initialize Plaid Link after an OAuth bank redirect. Without this,
  // the OAuth resume flow can't continue (Plaid requires the original
  // link_token + receivedRedirectUri). 404 if there's no in-flight token.
  app.get("/api/plaid/link-token-current", requireAuth, async (req, res) => {
    const token = Plaid.getInflightLinkToken(req.user!.id);
    if (!token) return res.status(404).json({ error: "no in-flight link token" });
    res.json({ linkToken: token });
  });

  app.post("/api/plaid/exchange", requireAuth, async (req, res) => {
    const { publicToken, institutionName } = req.body || {};
    if (!publicToken) return res.status(400).json({ error: "publicToken required" });
    try {
      const { accessToken, itemId } = await Plaid.exchangePublicToken(publicToken);
      const item = await storage.savePlaidItem(req.user!.id, {
        itemId,
        accessToken,
        institutionName: institutionName || "Unknown",
      });
      Plaid.clearInflightLinkToken(req.user!.id);
      res.json({ ok: true, item: { id: item.id, institutionName: item.institutionName } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/plaid/items", requireAuth, async (req, res) => {
    try {
      const items = await storage.getPlaidItems(req.user!.id);
      res.json(items.map(i => ({ id: i.id, itemId: i.itemId, institutionName: i.institutionName, createdAt: i.createdAt })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/plaid/items/:id", requireAuth, async (req, res) => {
    const itemId = req.params.id;
    try {
      const r = await storage.deletePlaidItem(req.user!.id, itemId);
      res.json({ ok: true, changes: r.changes });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Spotify status (legacy — used by SpotifyConnect in the app shell)
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/spotify/status", optionalAuth, async (req, res) => {
    try {
      if (!req.user) return res.json({ configured: false, authorized: false });
      res.json(await Spotify.userStatus(req.user.id));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Legacy config endpoint — now a no-op since creds come from env
  app.post("/api/spotify/config", async (req, res) => {
    res.json({ ok: true, note: "Spotify credentials are now configured via environment variables." });
  });

  app.get("/api/spotify/authorize", async (_req, res) => {
    try {
      const cfg = Spotify.getAppConfig();
      if (!cfg) return res.status(400).json({ message: "Spotify not configured. Set SPOTIFY_CLIENT_ID/SECRET env vars." });
      const state = randomUUID();
      const url = Spotify.buildAuthorizeUrl(state);
      res.json({ url });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Spotify callback for the legacy popup flow (used by SpotifyConnect)
  app.get("/api/spotify/callback", optionalAuth, async (req, res) => {
    const code = req.query.code as string | undefined;
    const err = req.query.error as string | undefined;
    if (err) return res.status(400).send(`Spotify authorization failed: ${err}`);
    if (!code) return res.status(400).send("Missing code");
    try {
      const tok = await Spotify.exchangeCodeForToken(code);
      // If the user is authenticated, save their refresh token
      if (req.user && tok.refresh_token) {
        await Spotify.saveUserRefreshToken(req.user.id, tok.refresh_token);
      }
      res.send(`<!doctype html><html><body style="font-family:system-ui;background:#0b0b0b;color:#fff;padding:48px;"><h1>Spotify connected.</h1><p>You can close this tab and refresh Life OS.</p><script>setTimeout(()=>{ if (window.opener) { try { window.opener.postMessage({ type: 'spotify-connected' }, '*'); } catch {} window.close(); } }, 600);</script></body></html>`);
    } catch (e: any) {
      res.status(500).send(`Token exchange failed: ${e.message}`);
    }
  });

  app.post("/api/spotify/disconnect", requireAuth, async (req, res) => {
    try {
      await Spotify.clearUserRefreshToken(req.user!.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Status (API keys availability)
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/status", (_req, res) => {
    res.json({
      tmdb: Boolean(TMDB_KEY),
      ticketmaster: Boolean(TM_KEY),
      plaid: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
      spotify: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
      now: new Date().toISOString(),
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Catalog (shows + films)
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/catalog", optionalAuth, async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();
    const kind = req.query.kind as "show" | "film" | undefined;
    const userId = req.user?.id;

    async function getUserCatalogItems(): Promise<CatalogItem[]> {
      if (!userId) return [];
      try {
        const pinFilm = kind === "show" ? [] : await storage.listUserItems(userId, "film");
        const pinShow = kind === "film" ? [] : await storage.listUserItems(userId, "show");
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

    const userCatalogItems = await getUserCatalogItems();

    if (TMDB_KEY && q) {
      const data = await tmdbFetch("/search/multi", { query: q, include_adult: "false", page: "1" });
      if (data?.results) {
        const items: CatalogItem[] = data.results
          .filter((r: any) => r.media_type === "tv" || r.media_type === "movie")
          .filter((r: any) => !kind || (kind === "show" ? r.media_type === "tv" : r.media_type === "movie"))
          .map((r: any) => tmdbToCatalogItem(r, r.media_type === "tv" ? "show" : "film"))
          .slice(0, 40);
        return res.json({ source: "tmdb", items: [...userCatalogItems, ...items] });
      }
    }
    if (TMDB_KEY && !q) {
      const [tv, mv] = await Promise.all([
        tmdbFetch("/trending/tv/week"),
        tmdbFetch("/trending/movie/week"),
      ]);
      const items: CatalogItem[] = [
        ...(tv?.results ?? []).map((r: any) => tmdbToCatalogItem(r, "show")),
        ...(mv?.results ?? []).map((r: any) => tmdbToCatalogItem(r, "film")),
      ].slice(0, 40);
      if (items.length) return res.json({ source: "tmdb", items: [...userCatalogItems, ...items] });
    }

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
    res.json({ source: "seed", items: [...userCatalogItems, ...items] });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Events (Ticketmaster + seed)
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/events", async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim();
    const category = req.query.category as SeedEvent["category"] | undefined;

    if (TM_KEY) {
      const params: Record<string, string> = { size: "40", sort: "date,asc" };
      if (city) params.city = city;
      if (category) params.segmentName = category === "Film" ? "Film" : category;
      const data = await tmFetch(params);
      const liveRaw: SeedEvent[] = (data?._embedded?.events ?? []).map(tmToEvent);
      const byKey = new Map<string, SeedEvent & { moreDates?: number }>();
      for (const e of liveRaw) {
        const key = `${e.name}::${e.venue}`.toLowerCase();
        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, { ...e, moreDates: 0 });
        } else {
          if (e.date && (!prev.date || e.date < prev.date)) {
            byKey.set(key, { ...e, moreDates: (prev.moreDates || 0) + 1 });
          } else {
            prev.moreDates = (prev.moreDates || 0) + 1;
          }
        }
      }
      const live = Array.from(byKey.values()).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      if (live.length) return res.json({ source: "ticketmaster", city: city || "any", items: live });
    }

    let items = seedEvents.slice();
    if (city) {
      const cl = city.toLowerCase();
      items = items.filter(e => e.city.toLowerCase().includes(cl));
    }
    if (category) items = items.filter(e => e.category === category);
    res.json({ source: "seed", city: city || "any", items });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Ratings
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/ratings", requireAuth, async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const items = await storage.listRatings(req.user!.id, kind);
    res.json(items.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })));
  });

  app.post("/api/ratings", requireAuth, async (req, res) => {
    const body = { ...req.body, meta: typeof req.body.meta === "object" ? JSON.stringify(req.body.meta) : req.body.meta };
    const parsed = insertRatingSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid rating", errors: parsed.error.flatten() });
    const r = await storage.upsertRating(req.user!.id, parsed.data);
    res.json({ ...r, meta: r.meta ? JSON.parse(r.meta) : null });
  });

  app.delete("/api/ratings/:kind/:externalId", requireAuth, async (req, res) => {
    const out = await storage.removeRating(req.user!.id, req.params.kind, req.params.externalId);
    res.json(out);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Portfolio
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/portfolio", optionalAuth, async (req, res) => {
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

    const userId = req.user?.id;

    // Try to fetch from Plaid items if user is connected
    let plaidData: any = null;
    if (userId && mode !== "demo") {
      try {
        const items = await storage.getPlaidItems(userId);
        if (items.length > 0) {
          // Aggregate from all Plaid items
          let allHoldings: any[] = [];
          let allSecurities: any[] = [];
          for (const item of items) {
            try {
              const data = await Plaid.getInvestmentHoldings(item.accessToken);
              allHoldings = allHoldings.concat(data.holdings || []);
              allSecurities = allSecurities.concat(data.securities || []);
            } catch {}
          }
          if (allHoldings.length > 0) {
            plaidData = { holdings: allHoldings, securities: allSecurities, source: "plaid-live" };
          }
        }
      } catch {}
    }

    const manual = (mode === "demo" || !userId) ? [] : await storage.listHoldings(userId);
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
        id: h.id, kind: h.kind, symbol: h.symbol,
        name: h.name || px?.name || h.symbol,
        quantity: h.quantity, costBasis: h.costBasis,
        price, value, dayChangePct, gainAbs, gainPct,
        priceSource: px ? (h.kind === "stock" ? "yahoo" : "coingecko") : "costBasis",
      };
    });

    const effectivePlaid = plaidData || (mode === "demo" ? null : snapshot);
    res.json({
      source: effectivePlaid ? (plaidData ? "plaid-live" : mode === "demo" ? "demo" : "plaid+manual") : (manual.length ? "manual" : "empty"),
      mode,
      plaid: effectivePlaid,
      manual: manualEnriched,
      asOf: new Date().toISOString(),
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Holdings (manual entry)
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/holdings", requireAuth, async (req, res) => {
    const kind = req.query.kind as string | undefined;
    res.json(await storage.listHoldings(req.user!.id, kind));
  });

  app.post("/api/holdings", requireAuth, async (req, res) => {
    const parsed = insertHoldingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid holding", errors: parsed.error.flatten() });
    if (!['stock', 'crypto'].includes(parsed.data.kind)) return res.status(400).json({ message: "kind must be 'stock' or 'crypto'" });
    const h = await storage.addHolding(req.user!.id, parsed.data);
    res.json(h);
  });

  app.patch("/api/holdings/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const h = await storage.updateHolding(req.user!.id, id, req.body);
    if (!h) return res.status(404).json({ message: "Holding not found" });
    res.json(h);
  });

  app.delete("/api/holdings/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.json(await storage.removeHolding(req.user!.id, id));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Index funds & crypto reference quotes
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/index-quote/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
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

  // ══════════════════════════════════════════════════════════════════════════
  // Music recs (Spotify)
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/music-recs", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const section = (req.query.section as string | undefined) || "recent";
    const userId = req.user?.id;

    try {
      if (mode === "demo" || !userId) {
        const snap = loadSnapshot<any>("music-snapshot-demo.json") || { source: "none", tracks: [] };
        if (Array.isArray(snap.tracks) && userId) {
          const { items, learning } = await rerankWithFeedback(snap.tracks, userId, "music",
            (t: any) => String(t.id || t.name),
            (t: any) => `${t.name || ""} ${t.artist || ""} ${t.album || ""}`,
          );
          snap.tracks = items;
          snap.learning = learning;
        }
        return res.json(snap);
      }

      const st = await Spotify.userStatus(userId);
      if (!st.authorized) {
        return res.json({ source: "unauthorized", tracks: [], reason: "connect-spotify" });
      }
      let snap: any;
      if (section === "top") snap = await Spotify.getTopTracks(userId, "short_term", 20);
      else if (section === "new") snap = await Spotify.getNewReleasesFromFollowed(userId, { limit: 20, daysBack: 60 });
      else snap = await Spotify.getRecentlyPlayed(userId, 20);

      const pinned = await storage.listUserItems(userId, "music");
      const pinnedTracks = pinned.map(p => ({
        id: `user-${p.id}`,
        name: p.title,
        artist: p.subtitle || "",
        url: p.url || undefined,
        pinned: true,
        playedAt: new Date(p.createdAt).toISOString(),
      }));
      snap.tracks = [...pinnedTracks, ...snap.tracks];

      const { items, learning } = await rerankWithFeedback(snap.tracks, userId, "music",
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

  // ══════════════════════════════════════════════════════════════════════════
  // User items
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/user-items", requireAuth, async (req, res) => {
    try {
      const kind = req.query.kind as string | undefined;
      res.json(await storage.listUserItems(req.user!.id, kind));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/user-items", requireAuth, async (req, res) => {
    try {
      const parsed = insertUserItemSchema.parse(req.body);
      const row = await storage.addUserItem(req.user!.id, parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/user-items/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await storage.removeUserItem(req.user!.id, id);
      res.json(r);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Places recs
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/places-recs", async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const city = (req.query.city as string | undefined)?.trim() || (mode === "demo" ? "Los Angeles" : "Honolulu");
    if (mode === "demo") {
      return res.json({
        source: "demo", city,
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
      const data = await tmFetch({ size: "60", city, sort: "date,asc", classificationName: "Arts" });
      const events: SeedEvent[] = (data?._embedded?.events ?? []).map(tmToEvent);
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

  // ══════════════════════════════════════════════════════════════════════════
  // Watchlist
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/watchlist", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const userId = req.user?.id;

    if (mode === "demo" || !userId) {
      const demo = [
        { id: -1, kind: "stock", symbol: "AMD", name: "Advanced Micro Devices", note: "AI infra exposure", createdAt: Date.now() },
        { id: -2, kind: "stock", symbol: "PLTR", name: "Palantir Technologies", note: "Govt + commercial AI", createdAt: Date.now() },
        { id: -3, kind: "stock", symbol: "SHOP", name: "Shopify", note: "Ecom platform play", createdAt: Date.now() },
        { id: -4, kind: "crypto", symbol: "SOL", name: "Solana", note: "Watching for breakout", createdAt: Date.now() },
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
    const items = await storage.listWatchlist(userId, kind);
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

  app.post("/api/watchlist", requireAuth, async (req, res) => {
    const parsed = insertWatchlistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid watchlist entry", errors: parsed.error.flatten() });
    if (!['stock', 'crypto'].includes(parsed.data.kind)) return res.status(400).json({ message: "kind must be 'stock' or 'crypto'" });
    const w = await storage.addWatchlist(req.user!.id, { ...parsed.data, symbol: parsed.data.symbol.toUpperCase() });
    res.json(w);
  });

  app.delete("/api/watchlist/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.json(await storage.removeWatchlist(req.user!.id, id));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Recommendations
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/recommendations", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const userId = req.user?.id;
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
    const manual = (mode === "demo" || !userId) ? [] : await storage.listHoldings(userId);
    const ownedTickers = new Set<string>([
      ...((snapshot?.holdings ?? []) as any[]).map(h => (h.ticker || "").toUpperCase()),
      ...manual.map(h => h.symbol.toUpperCase()),
    ]);

    const peers: Record<string, { symbol: string; name: string; reason: string; kind: "stock" | "crypto" }[]> = {
      NVDA: [{ symbol: "AMD", name: "Advanced Micro Devices", reason: "Direct AI-GPU competitor", kind: "stock" }, { symbol: "AVGO", name: "Broadcom", reason: "Custom AI silicon + networking", kind: "stock" }, { symbol: "TSM", name: "TSMC", reason: "Fabs every leading-edge chip", kind: "stock" }],
      MU: [{ symbol: "WDC", name: "Western Digital", reason: "Memory · storage cycle peer", kind: "stock" }, { symbol: "SMCI", name: "Super Micro", reason: "AI server demand for memory", kind: "stock" }],
      SOXL: [{ symbol: "SMH", name: "VanEck Semi ETF", reason: "Unleveraged broad semis", kind: "stock" }, { symbol: "SOXX", name: "iShares Semi ETF", reason: "Sector ETF, lower volatility", kind: "stock" }],
      TSM: [{ symbol: "ASML", name: "ASML", reason: "EUV monopoly upstream of TSMC", kind: "stock" }, { symbol: "AMAT", name: "Applied Materials", reason: "Wafer-fab equipment", kind: "stock" }],
      RKLB: [{ symbol: "ASTS", name: "AST SpaceMobile", reason: "Space adjacency, direct-to-cell", kind: "stock" }, { symbol: "LMT", name: "Lockheed Martin", reason: "Established launch + defense", kind: "stock" }, { symbol: "PL", name: "Planet Labs", reason: "Satellite imagery peer", kind: "stock" }],
      ASTS: [{ symbol: "RKLB", name: "Rocket Lab", reason: "Launch provider for sat constellations", kind: "stock" }, { symbol: "IRDM", name: "Iridium", reason: "Established sat-to-phone", kind: "stock" }],
      TSLA: [{ symbol: "RIVN", name: "Rivian", reason: "US EV peer", kind: "stock" }, { symbol: "BYDDY", name: "BYD", reason: "Global EV leader", kind: "stock" }, { symbol: "NIO", name: "NIO", reason: "China EV battery-swap model", kind: "stock" }],
      IBKR: [{ symbol: "SCHW", name: "Charles Schwab", reason: "Retail brokerage giant", kind: "stock" }, { symbol: "HOOD", name: "Robinhood", reason: "Younger retail demo", kind: "stock" }],
      SPY: [{ symbol: "VOO", name: "Vanguard S&P 500", reason: "Lower expense ratio S&P", kind: "stock" }, { symbol: "IVV", name: "iShares Core S&P 500", reason: "S&P alternative", kind: "stock" }],
      QQQ: [{ symbol: "QQQM", name: "Invesco NASDAQ 100", reason: "Cheaper QQQ for buy-and-hold", kind: "stock" }, { symbol: "XLK", name: "Tech Select Sector SPDR", reason: "Pure tech exposure", kind: "stock" }],
      VTI: [{ symbol: "ITOT", name: "iShares Core S&P Total Market", reason: "Total-market alternative", kind: "stock" }],
      AAPL: [{ symbol: "GOOGL", name: "Alphabet", reason: "Mega-cap tech peer", kind: "stock" }, { symbol: "META", name: "Meta Platforms", reason: "Mobile ad + AI infra", kind: "stock" }],
      MSFT: [{ symbol: "GOOGL", name: "Alphabet", reason: "Cloud + AI competitor", kind: "stock" }, { symbol: "ORCL", name: "Oracle", reason: "Enterprise + cloud", kind: "stock" }],
      BTC: [{ symbol: "ETH", name: "Ethereum", reason: "Largest alt; smart-contract layer", kind: "crypto" }, { symbol: "IBIT", name: "iShares Bitcoin Trust", reason: "Spot BTC ETF via brokerage", kind: "stock" }],
      ETH: [{ symbol: "SOL", name: "Solana", reason: "High-throughput L1", kind: "crypto" }, { symbol: "ARB", name: "Arbitrum", reason: "Eth L2 ecosystem", kind: "crypto" }],
      SOL: [{ symbol: "AVAX", name: "Avalanche", reason: "Subnet architecture L1 peer", kind: "crypto" }, { symbol: "NEAR", name: "NEAR Protocol", reason: "Sharded L1", kind: "crypto" }],
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

  // ══════════════════════════════════════════════════════════════════════════
  // Bull/Bear
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/bullbear", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const seed = parseInt((req.query.seed as string) || `${Date.now()}`, 10) || 1;
    const userId = req.user?.id;
    let snapshot: any = null;
    const fileName = mode === "demo" ? "portfolio-snapshot-demo.json" : "portfolio-snapshot.json";
    for (const p of [join(process.cwd(), `server/data/${fileName}`), join(process.cwd(), `data/${fileName}`), join(process.cwd(), `../server/data/${fileName}`)]) {
      try { snapshot = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
    }
    const manual = (mode === "demo" || !userId) ? [] : await storage.listHoldings(userId);
    const allTickers: string[] = [
      ...((snapshot?.holdings ?? []) as any[]).map(h => (h.ticker || "").toUpperCase()),
      ...manual.map(h => h.symbol.toUpperCase()),
    ].filter(Boolean);
    const uniq = Array.from(new Set(allTickers));

    const angles: Record<string, { bull: string[]; bear: string[] }> = {
      NVDA: { bull: ["Data-center revenue still doubling YoY — Blackwell ramp ahead", "Sovereign AI deals (Saudi, UAE) extending TAM beyond hyperscalers", "CUDA moat keeps competitors on the back foot"], bear: ["Hyperscaler capex shows first signs of digestion", "Custom silicon (Trainium, TPU) chips away at GPU share", "Multiple compression risk — priced for perfection"] },
      MU: { bull: ["HBM3e supply is sold out through 2026", "DRAM pricing has bottomed; up-cycle pricing power returning", "AI memory bandwidth needs grow faster than compute"], bear: ["Memory is cyclical — oversupply always returns", "Samsung HBM qualification risks share loss", "China demand exposure adds geopolitical tail risk"] },
      SPY: { bull: ["Earnings broadening beyond Mag 7 supports continued rally", "Fed cuts likely in 2026 — multiple expansion tailwind", "Historical baseline returns ~10% annualized"], bear: ["S&P P/E sits above 21x — above long-term mean", "Concentration risk in top 10 names", "Recession indicators (yield curve, LEI) still flashing"] },
      QQQ: { bull: ["AI capex still in early innings for Nasdaq 100", "Mega-cap balance sheets are pristine", "Software margin expansion continues"], bear: ["~50% concentration in top 7 names is fragility", "Tech beta amplifies any growth scare", "Antitrust action against AAPL/GOOGL/META is live"] },
      BTC: { bull: ["Spot ETF flows institutionalize demand", "Post-halving supply shock thesis intact", "Sovereign + corporate treasuries accumulating"], bear: ["Macro liquidity tightens — BTC trades as risk asset", "Regulatory whiplash possible with new administrations", "Mining concentration is a centralization risk"] },
      ETH: { bull: ["L2 scaling unlocking new on-chain volume", "Ultrasound-money thesis: net deflationary issuance", "Restaking economies of scale forming"], bear: ["Solana eating L1 mindshare for new apps", "L2 fragmentation weakens mainnet fee accrual", "Regulatory classification still unresolved"] },
      SOL: { bull: ["Real-world transactions per second leader", "DePIN + meme economy = real revenue", "Firedancer client coming online"], bear: ["Network outages a recurring concern", "VC unlocks still ahead", "Centralization tradeoff is real"] },
    };

    const candidates = uniq.filter(t => angles[t]).slice(0, 12);
    const fillers = ["SPY", "QQQ", "BTC", "ETH", "NVDA"].filter(t => !candidates.includes(t) && angles[t]);
    const pool = [...candidates, ...fillers].slice(0, 8);
    const rng = mulberry32(seed);
    const shuffled = pool.slice().sort(() => rng() - 0.5).slice(0, 5);
    const list = shuffled.map(sym => {
      const a = angles[sym];
      const bullIdx = Math.floor(rng() * a.bull.length);
      const bearIdx = Math.floor(rng() * a.bear.length);
      return { symbol: sym, bull: a.bull[bullIdx], bear: a.bear[bearIdx] };
    });
    res.json({ items: list, asOf: new Date().toISOString(), seed });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Market movers
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/market-movers", async (_req, res) => {
    try {
      const [gainersRes, losersRes] = await Promise.all([
        fetch("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=5&scrIds=day_gainers", { headers: { "User-Agent": "Mozilla/5.0" } }),
        fetch("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=5&scrIds=day_losers", { headers: { "User-Agent": "Mozilla/5.0" } }),
      ]);
      const gJson: any = gainersRes.ok ? await gainersRes.json() : null;
      const lJson: any = losersRes.ok ? await losersRes.json() : null;
      const mapQuote = (q: any) => ({
        symbol: q.symbol, name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice, dayChangePct: q.regularMarketChangePercent,
        dayChangeAbs: q.regularMarketChange, marketCap: q.marketCap, volume: q.regularMarketVolume,
      });
      const gainers = (gJson?.finance?.result?.[0]?.quotes ?? []).slice(0, 5).map(mapQuote);
      const losers = (lJson?.finance?.result?.[0]?.quotes ?? []).slice(0, 5).map(mapQuote);
      res.json({ gainers, losers, asOf: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ message: e.message, gainers: [], losers: [] });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Portfolio history
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/portfolio-history", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const userId = req.user?.id;
    const fileName = mode === "demo" ? "portfolio-snapshot-demo.json" : "portfolio-snapshot.json";
    let snapshot: any = null;
    for (const p of [join(process.cwd(), `server/data/${fileName}`), join(process.cwd(), `data/${fileName}`), join(process.cwd(), `../server/data/${fileName}`)]) {
      try { snapshot = JSON.parse(readFileSync(p, "utf8")); break; } catch {}
    }
    const manual = (mode === "demo" || !userId) ? [] : await storage.listHoldings(userId);
    const holdingsArr = [
      ...((snapshot?.holdings ?? []) as any[]).map((h: any) => ({
        value: h.value, dayChangePct: h.dayChangePct || 0, changeMo: h.changeMo || 0, change6Mo: h.change6Mo || 0,
      })),
    ];
    let now = holdingsArr.reduce((s, h) => s + h.value, 0);
    let oneDay = holdingsArr.reduce((s, h) => s + (h.value / (1 + h.dayChangePct / 100)), 0);
    let oneMo = holdingsArr.reduce((s, h) => s + (h.value / (1 + h.changeMo / 100)), 0);
    let sixMo = holdingsArr.reduce((s, h) => s + (h.value / (1 + h.change6Mo / 100)), 0);
    const manualValue = manual.reduce((s, h) => s + h.quantity * h.costBasis, 0);
    now += manualValue; oneDay += manualValue; oneMo += manualValue; sixMo += manualValue;

    const points: { t: string; v: number }[] = [];
    const today = new Date();
    function dateBack(days: number) {
      const d = new Date(today); d.setDate(d.getDate() - days);
      return d.toISOString().slice(0, 10);
    }
    const anchors: { days: number; v: number }[] = [
      { days: 180, v: sixMo }, { days: 90, v: sixMo + (oneMo - sixMo) * 0.6 },
      { days: 30, v: oneMo }, { days: 14, v: oneMo + (oneDay - oneMo) * 0.55 },
      { days: 7, v: oneMo + (oneDay - oneMo) * 0.78 }, { days: 1, v: oneDay }, { days: 0, v: now },
    ];
    for (const a of anchors) points.push({ t: dateBack(a.days), v: Math.round(a.v * 100) / 100 });
    res.json({
      points, currentValue: Math.round(now * 100) / 100,
      sixMonthReturnPct: sixMo > 0 ? ((now - sixMo) / sixMo) * 100 : 0,
      oneMonthReturnPct: oneMo > 0 ? ((now - oneMo) / oneMo) * 100 : 0,
      dayReturnPct: oneDay > 0 ? ((now - oneDay) / oneDay) * 100 : 0,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Concerts for you
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/concerts-for-you", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const city = (req.query.city as string | undefined)?.trim() || (mode === "demo" ? "Los Angeles" : "Honolulu");
    const userId = req.user?.id;

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
    if (mode === "live" && userId) {
      const st = await Spotify.userStatus(userId).catch(() => ({ authorized: false } as any));
      if (st.authorized) {
        try {
          const [followed, recent, top] = await Promise.all([
            Spotify.getFollowedArtists(userId, 20).catch(() => []),
            Spotify.getRecentlyPlayed(userId, 20).catch(() => ({ tracks: [] as any[] })),
            Spotify.getTopTracks(userId, "short_term", 20).catch(() => ({ tracks: [] as any[] })),
          ]);
          for (const a of followed) pushArtist(a.name);
          for (const t of (recent as any).tracks || []) pushArtist(t.artist);
          for (const t of (top as any).tracks || []) pushArtist(t.artist);
          basisLabel = "Followed or recently played on Spotify";
        } catch {}
      }
      if (userId) {
        const pinnedArtists = await storage.listUserItems(userId, "artist").catch(() => []);
        for (const p of pinnedArtists) pushArtist(p.title);
      }
    }

    if (artists.length === 0) {
      const fileName = mode === "demo" ? "music-snapshot-demo.json" : "music-snapshot.json";
      const snap = loadSnapshot<any>(fileName);
      if (snap && Array.isArray(snap.tracks)) {
        for (const t of snap.tracks) pushArtist(t.artist || "");
      }
    }
    if (artists.length === 0) return res.json({ source: "none", city, concerts: [] });

    if (!TM_KEY) {
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
    for (const a of artists.slice(0, 10)) {
      try {
        const data = await tmFetch({ size: "3", keyword: a, city, sort: "date,asc" });
        const events: any[] = data?._embedded?.events ?? [];
        for (const e of events) {
          concerts.push({
            artist: a, name: e.name,
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

    if (concerts.length === 0) {
      try {
        const data = await tmFetch({ size: "10", city, classificationName: "music", sort: "date,asc" });
        const events: any[] = data?._embedded?.events ?? [];
        for (const e of events) {
          concerts.push({
            artist: e.name?.split(" at ")[0] || e.name, name: e.name,
            venue: e._embedded?.venues?.[0]?.name || "",
            city: e._embedded?.venues?.[0]?.city?.name || city,
            date: e.dates?.start?.localDate || "", url: e.url,
            basedOn: "Music event near you",
          });
        }
      } catch {}
    }

    const effectiveUserId = userId ?? 0;
    const { items: ranked, learning } = await rerankWithFeedback(
      concerts, effectiveUserId, "concert",
      (c: any) => `${c.artist || c.name}-${c.date || ""}`,
      (c: any) => `${c.artist || ""} ${c.name || ""} ${c.venue || ""}`,
    );
    res.json({ source: "ticketmaster", city, concerts: ranked, learning });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Listening history
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/listening-history", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const userId = req.user?.id;
    let tracks: any[] = [];
    let sourceLabel = mode;

    if (mode === "live" && userId) {
      const st = await Spotify.userStatus(userId).catch(() => ({ authorized: false } as any));
      if (st.authorized) {
        try {
          const [recent, top] = await Promise.all([
            Spotify.getRecentlyPlayed(userId, 50),
            Spotify.getTopTracks(userId, "medium_term", 50),
          ]);
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
    const buckets = Array.from(decadeMap.entries()).map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade.localeCompare(b.decade));
    const topArtists = Array.from(artistMap.entries()).map(([artist, count]) => ({ artist, count })).sort((a, b) => b.count - a.count).slice(0, 6);
    res.json({ source: sourceLabel, buckets, topArtists, total: tracks.length });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Food spots
  // ══════════════════════════════════════════════════════════════════════════

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

  app.get("/api/food-spots", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const q = (req.query.q as string | undefined)?.trim() || "";
    const city = (req.query.city as string | undefined)?.trim() || (mode === "demo" ? "Los Angeles" : "Honolulu");
    const source = (req.query.source as string | undefined)?.trim();
    const userId = req.user?.id;

    const curatedAll = mode === "demo" ? CURATED_FOOD_DEMO : CURATED_FOOD;
    let curated = curatedAll.filter(c => c.city.toLowerCase().includes(city.toLowerCase()));
    if (q) curated = curated.filter(c =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.category || "").toLowerCase().includes(q.toLowerCase()) ||
      (c.note || "").toLowerCase().includes(q.toLowerCase())
    );

    const stored = userId ? await storage.listFoodSpots(userId, { city, query: q || undefined }) : [];
    const manual = stored.filter(s => s.source === "manual");
    const osm = stored.filter(s => s.source === "osm");

    const showAll = !source || source === "all";
    let results: any[] = [];
    if (showAll || source === "curated") results = results.concat(curated);
    if (showAll || source === "manual") results = results.concat(manual);
    if (showAll || source === "osm") results = results.concat(osm);

    res.json({ city, query: q, count: results.length, results });
  });

  app.post("/api/food-spots", requireAuth, async (req, res) => {
    try {
      const parsed = insertFoodSpotSchema.parse(req.body);
      const row = await storage.addFoodSpot(req.user!.id, parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/food-spots/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const r = await storage.removeFoodSpot(req.user!.id, id);
    res.json(r);
  });

  app.get("/api/food-spots/osm", async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
    const query = `[out:json][timeout:25];\narea[name="${city}"]->.a;\n(node["amenity"~"restaurant|cafe|bar"](area.a);)\n;out center 30;`;
    try {
      const r = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST", body: query, headers: { "Content-Type": "text/plain" },
      });
      if (!r.ok) return res.json({ city, results: [] });
      const data = await r.json();
      const results = (data.elements || []).slice(0, 30).map((el: any) => ({
        name: el.tags?.name || "Unnamed", city,
        category: el.tags?.cuisine || el.tags?.amenity || "",
        note: el.tags?.["addr:street"] ? `${el.tags["addr:housenumber"] || ""} ${el.tags["addr:street"]}`.trim() : "",
        url: el.tags?.website || "",
        source: "osm",
      })).filter((x: any) => x.name !== "Unnamed");
      res.json({ city, results });
    } catch (e: any) { res.json({ city, results: [], error: e.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Subscriptions
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/subscriptions", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const userId = req.user?.id;
    const fileName = mode === "demo" ? "transactions-snapshot-demo.json" : "transactions-snapshot.json";
    const snap = loadSnapshot<any>(fileName);

    const detected: any[] = [];
    if (snap?.transactions) {
      const byMerchant = new Map<string, { dates: string[]; amounts: number[]; category: string }>();
      for (const t of snap.transactions) {
        if (t.category !== "Subscription") continue;
        const entry = byMerchant.get(t.merchant) || { dates: [], amounts: [], category: t.category };
        entry.dates.push(t.date); entry.amounts.push(t.amount);
        byMerchant.set(t.merchant, entry);
      }
      for (const [merchant, info] of byMerchant) {
        if (info.dates.length >= 2) {
          const sorted = info.dates.slice().sort();
          const gaps: number[] = [];
          for (let i = 1; i < sorted.length; i++) {
            gaps.push((new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 86400000);
          }
          const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          const cadence = avgGap >= 25 && avgGap <= 35 ? "monthly" : avgGap >= 6 && avgGap <= 8 ? "weekly" : avgGap >= 350 ? "yearly" : "monthly";
          const avgAmount = info.amounts.reduce((a, b) => a + b, 0) / info.amounts.length;
          const lastDate = new Date(sorted[sorted.length - 1]);
          const next = new Date(lastDate.getTime() + avgGap * 86400000);
          detected.push({
            id: `detected-${merchant.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            name: merchant, amount: Math.round(avgAmount * 100) / 100,
            cadence, category: info.category, source: "detected",
            nextCharge: next.toISOString().slice(0, 10),
            basedOn: `${info.dates.length} charges over ${Math.round((new Date(sorted[sorted.length - 1]).getTime() - new Date(sorted[0]).getTime()) / 86400000)} days`,
          });
        }
      }
    }
    const manual = userId ? await storage.listSubscriptions(userId) : [];
    const totalMonthly = [...detected, ...manual].reduce((s, x) => {
      if (x.cadence === "monthly") return s + x.amount;
      if (x.cadence === "yearly") return s + x.amount / 12;
      if (x.cadence === "weekly") return s + x.amount * 4.33;
      return s;
    }, 0);
    res.json({ detected, manual, all: [...detected, ...manual], totalMonthly: Math.round(totalMonthly * 100) / 100 });
  });

  app.post("/api/subscriptions", requireAuth, async (req, res) => {
    try {
      const parsed = insertSubscriptionSchema.parse(req.body);
      const row = await storage.addSubscription(req.user!.id, parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/subscriptions/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const r = await storage.removeSubscription(req.user!.id, id);
    res.json(r);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Sentiment engine
  // ══════════════════════════════════════════════════════════════════════════

  // In-memory cache: `${symbol}:${weeks}` → { data, expiresAt }
  const sentimentCache = new Map<string, { data: SentimentResult; expiresAt: number }>();
  const SENTIMENT_TTL = 5 * 60 * 1000; // 5 minutes

  interface SentimentResult {
    symbol: string;
    currentPrice: number | null;
    returnPct: number | null;
    sentiment: number;
    label: string;
  }

  function scoreToLabel(s: number): string {
    if (s >= 0.75) return "Strong Bullish";
    if (s >= 0.25) return "Bullish";
    if (s > -0.25) return "Neutral";
    if (s > -0.75) return "Bearish";
    return "Strong Bearish";
  }

  function returnPctToSentiment(pct: number): number {
    if (pct >= 30) return 1.0;
    if (pct >= 5) return 0.5;
    if (pct > -5) return 0.0;
    if (pct > -30) return -0.5;
    return -1.0;
  }

  async function fetchSentiment(symbol: string, weeks: number): Promise<SentimentResult> {
    const cacheKey = `${symbol}:${weeks}`;
    const cached = sentimentCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    try {
      const range = `${weeks}wk`;
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (!r.ok) throw new Error(`Yahoo ${r.status}`);
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error("no result");
      const meta = result.meta;
      const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((c: any) => c != null);
      if (!closes.length) throw new Error("no closes");
      const first = closes[0];
      const last = meta.regularMarketPrice ?? closes[closes.length - 1];
      const returnPct = first > 0 ? ((last - first) / first) * 100 : 0;
      const sentiment = returnPctToSentiment(returnPct);
      const out: SentimentResult = {
        symbol,
        currentPrice: last,
        returnPct,
        sentiment,
        label: scoreToLabel(sentiment),
      };
      sentimentCache.set(cacheKey, { data: out, expiresAt: Date.now() + SENTIMENT_TTL });
      return out;
    } catch {
      const out: SentimentResult = { symbol, currentPrice: null, returnPct: null, sentiment: 0, label: "Neutral" };
      return out;
    }
  }

  app.get("/api/sentiment/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const weeks = Math.max(1, Math.min(52, parseInt((req.query.weeks as string) || "13", 10) || 13));
    try {
      const out = await fetchSentiment(symbol, weeks);
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/sentiment/batch", async (req, res) => {
    const { symbols, weeks: rawWeeks } = req.body || {};
    if (!Array.isArray(symbols)) return res.status(400).json({ message: "symbols array required" });
    const weeks = Math.max(1, Math.min(52, parseInt(String(rawWeeks || 13), 10) || 13));
    const uniq = Array.from(new Set((symbols as string[]).map((s) => String(s).toUpperCase()).filter(Boolean)));
    const results = await Promise.all(
      uniq.map((sym) => fetchSentiment(sym, weeks).catch(() => null))
    );
    res.json(results.filter(Boolean));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Chart history (for ETF tiles + click-to-chart)
  // ══════════════════════════════════════════════════════════════════════════

  interface ChartHistory {
    symbol: string;
    currentPrice: number | null;
    returnPct: number | null;
    ytdReturnPct: number | null;
    closes: number[]; // downsampled, max 60 points
    weeks: number;
  }

  const chartCache = new Map<string, { data: ChartHistory; expiresAt: number }>();
  const CHART_TTL = 5 * 60 * 1000;

  function downsample(arr: number[], maxPoints = 60): number[] {
    if (arr.length <= maxPoints) return arr;
    const step = arr.length / maxPoints;
    const out: number[] = [];
    for (let i = 0; i < maxPoints; i++) out.push(arr[Math.floor(i * step)]);
    out.push(arr[arr.length - 1]);
    return out;
  }

  async function fetchChartHistory(symbol: string, weeks: number): Promise<ChartHistory> {
    const cacheKey = `${symbol}:${weeks}`;
    const cached = chartCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    try {
      // Always fetch 1y so we can derive YTD locally
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (!r.ok) throw new Error(`Yahoo ${r.status}`);
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error("no result");
      const meta = result.meta;
      const tsArr: number[] = result.timestamp ?? [];
      const closesAll: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

      // pair (ts, close) and drop nulls
      const pairs: { t: number; c: number }[] = [];
      for (let i = 0; i < tsArr.length; i++) {
        const c = closesAll[i];
        if (c != null) pairs.push({ t: tsArr[i], c });
      }
      if (!pairs.length) throw new Error("no closes");

      const last = meta.regularMarketPrice ?? pairs[pairs.length - 1].c;

      // Slice to active lookback window (from end)
      const tradingDays = Math.max(5, Math.round(weeks * 5));
      const sliced = pairs.slice(Math.max(0, pairs.length - tradingDays));
      const firstClose = sliced[0].c;
      const returnPct = firstClose > 0 ? ((last - firstClose) / firstClose) * 100 : 0;

      // YTD: find first pair on or after Jan 1 of current year
      const ytdStart = new Date(new Date().getUTCFullYear(), 0, 1).getTime() / 1000;
      const ytdAnchor = pairs.find((p) => p.t >= ytdStart) ?? pairs[0];
      const ytdReturnPct = ytdAnchor.c > 0 ? ((last - ytdAnchor.c) / ytdAnchor.c) * 100 : 0;

      const out: ChartHistory = {
        symbol,
        currentPrice: last,
        returnPct,
        ytdReturnPct,
        closes: downsample(sliced.map((p) => p.c)),
        weeks,
      };
      chartCache.set(cacheKey, { data: out, expiresAt: Date.now() + CHART_TTL });
      return out;
    } catch {
      return {
        symbol,
        currentPrice: null,
        returnPct: null,
        ytdReturnPct: null,
        closes: [],
        weeks,
      };
    }
  }

  app.get("/api/chart-history/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const weeks = Math.max(1, Math.min(52, parseInt((req.query.weeks as string) || "13", 10) || 13));
    try {
      const out = await fetchChartHistory(symbol, weeks);
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/chart-history/batch", async (req, res) => {
    const { symbols, weeks: rawWeeks } = req.body || {};
    if (!Array.isArray(symbols)) return res.status(400).json({ message: "symbols array required" });
    const weeks = Math.max(1, Math.min(52, parseInt(String(rawWeeks || 13), 10) || 13));
    const uniq = Array.from(new Set((symbols as string[]).map((s) => String(s).toUpperCase()).filter(Boolean)));
    const results = await Promise.all(
      uniq.map((sym) => fetchChartHistory(sym, weeks).catch(() => null))
    );
    res.json(results.filter(Boolean));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Category leaders (sector trophy cards)
  // ══════════════════════════════════════════════════════════════════════════

  // Curated universe — symbol → sector. Kept tight on purpose so each batch
  // is fast and cache-friendly.
  const SECTOR_UNIVERSE: Record<string, string[]> = {
    "Tech":       ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AMD", "ORCL", "CRM"],
    "Finance":    ["JPM", "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "V", "MA", "AXP"],
    "Healthcare": ["LLY", "UNH", "JNJ", "ABBV", "PFE", "MRK", "TMO", "ABT", "DHR", "ISRG"],
    "Consumer":   ["WMT", "COST", "HD", "NKE", "MCD", "SBUX", "PG", "KO", "PEP", "DIS"],
    "Energy":     ["XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX", "MPC", "VLO", "HES"],
    "Crypto":     ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "MATIC"],
  };

  // Crypto symbols on Yahoo Finance are quoted as `<TICKER>-USD`
  function yahooSymbol(sym: string, sector: string): string {
    if (sector === "Crypto") return `${sym}-USD`;
    return sym;
  }

  app.post("/api/sector-leaders", async (req, res) => {
    const { weeks: rawWeeks } = req.body || {};
    const weeks = Math.max(1, Math.min(52, parseInt(String(rawWeeks || 13), 10) || 13));

    try {
      const sectors = await Promise.all(
        Object.entries(SECTOR_UNIVERSE).map(async ([name, symbols]) => {
          const rows = await Promise.all(
            symbols.map(async (s) => {
              const yhSym = yahooSymbol(s, name);
              const r = await fetchSentiment(yhSym, weeks).catch(() => null);
              if (!r) return null;
              return { symbol: s, displaySymbol: s, returnPct: r.returnPct, sentiment: r.sentiment, currentPrice: r.currentPrice };
            })
          );
          const sorted = (rows.filter(Boolean) as { symbol: string; displaySymbol: string; returnPct: number | null; sentiment: number; currentPrice: number | null }[])
            .filter((x) => x.returnPct != null)
            .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));
          const leader = sorted[0] ?? null;
          return {
            name,
            leader,
            top10: sorted.slice(0, 10),
          };
        })
      );
      res.json({ sectors, weeks });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Rec feedback
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/rec-feedback", requireAuth, async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const rows = await storage.listRecFeedback(req.user!.id, kind);
    res.json(rows);
  });

  app.post("/api/rec-feedback", requireAuth, async (req, res) => {
    try {
      const parsed = insertRecFeedbackSchema.parse(req.body);
      const row = await storage.upsertRecFeedback(req.user!.id, parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/rec-feedback/:kind/:externalId", requireAuth, async (req, res) => {
    const r = await storage.removeRecFeedback(req.user!.id, req.params.kind, req.params.externalId);
    res.json(r);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Travel guide
  // ══════════════════════════════════════════════════════════════════════════

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
        { name: "Bishop Museum", note: "State museum of Hawaiian + Pacific culture—the deep history of the islands", url: "https://www.bishopmuseum.org" },
        { name: "Lanikai Pillbox Hike", note: "Short, steep climb to a turquoise overlook on the windward side", url: "" },
        { name: "Waikiki Beach", note: "Touristy but iconic—best at dawn before the crowds", url: "" },
        { name: "Iolani Palace", note: "Only royal palace on US soil; tour the throne room and basement gallery", url: "https://www.iolanipalace.org" },
      ],
      neighborhoods: [
        { name: "Kakaako", note: "Street art, breweries, design-forward cafes—the warehouse district reborn" },
        { name: "Chinatown", note: "Morning markets, evening cocktails, galleries between" },
        { name: "Kaimuki", note: "Foodie strip on Waialae Ave—ramen, wine bars, indie shops" },
        { name: "Manoa", note: "University vibe, lush valley, the gentle rainforest hike to the falls" },
        { name: "Kailua", note: "Windward laid-back side; bakery, paddle boards, soft-sand beaches" },
      ],
      dayTrips: [
        { name: "North Shore (Haleiwa, Sunset, Pipe)", note: "Shrimp trucks, surf spectatorship, Waimea Bay", distance: "~1h drive" },
        { name: "Kualoa Ranch", note: "Movie-set valleys; ATV, horseback, ziplines", distance: "~45m" },
        { name: "Hanauma Bay", note: "Reserved snorkeling reef—reservation required, opens 6:45am", distance: "~25m" },
        { name: "Manoa Falls", note: "Half-day rainforest hike—muddy after rain", distance: "~20m" },
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
  };

  function genericGuide(city: string): TravelGuide {
    return {
      city,
      sights: [
        { name: "Old town / historic center", note: `Start in ${city}'s oldest district—the architectural anchor of the city.` },
        { name: "Main museum", note: `Every major city has one definitive museum. Search "${city} art museum" and start there.` },
        { name: "Iconic viewpoint", note: "Find the elevated viewpoint locals send tourists to—usually a hill, tower, or rooftop." },
      ],
      neighborhoods: [
        { name: "Downtown core", note: "Walkable city center—cafes, shopping, the central park or plaza." },
        { name: "Creative district", note: "Galleries, breweries, repurposed industrial buildings." },
        { name: "Residential village", note: "Quieter streets, neighborhood cafes, parks—where locals actually live." },
      ],
      dayTrips: [
        { name: "Nearest natural escape", note: "Search for the closest national / state park or beach within ~1h." },
        { name: "Smaller town nearby", note: "Every metro has a charming small town 30-60min out for a slow-paced day." },
      ],
    };
  }

  app.get("/api/travel-guide", optionalAuth, async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
    const key = city.toLowerCase();
    const guide = CURATED_GUIDES[key] || genericGuide(city);
    const curated = !!CURATED_GUIDES[key];
    const userId = req.user?.id;

    try {
      const pinned = userId ? await storage.listUserItems(userId, "place") : [];
      const pinnedSights = pinned.map(p => ({
        name: p.title, note: p.subtitle || "Added by you", url: p.url || undefined,
        pinned: true, userItemId: p.id,
      }));
      const merged = { ...guide, sights: [...pinnedSights, ...guide.sights] };
      return res.json({ ...merged, curated });
    } catch {
      return res.json({ ...guide, curated });
    }
  });

  app.get("/api/places-events", async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
    if (!TM_KEY) return res.json({ source: "none", city, events: [] });
    try {
      const data = await tmFetch({ size: "15", city, sort: "date,asc" });
      const events: any[] = data?._embedded?.events ?? [];
      const out = events.map((e: any) => ({
        name: e.name, venue: e._embedded?.venues?.[0]?.name || "",
        city: e._embedded?.venues?.[0]?.city?.name || city,
        date: e.dates?.start?.localDate || "",
        category: (() => {
          const c = e.classifications?.[0];
          const seg = c?.segment?.name;
          const gen = c?.genre?.name;
          const sub = c?.subGenre?.name;
          const pick = [seg, gen, sub].find((x) => x && x !== "Undefined" && x !== "Miscellaneous");
          return pick || "";
        })(),
        url: e.url,
      }));
      // No userId-specific reranking for events (no auth required)
      res.json({ source: "ticketmaster", city, events: out });
    } catch {
      res.json({ source: "ticketmaster", city, events: [] });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Bookmarks (reuses ratings with signal=0)
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/bookmarks", requireAuth, async (req, res) => {
    const kind = req.query.kind as string | undefined;
    const all = await storage.listRatings(req.user!.id, kind);
    res.json({ bookmarks: all.filter((r) => r.signal === 0) });
  });

  app.post("/api/bookmarks", requireAuth, async (req, res) => {
    try {
      const { kind, externalId, title, meta } = req.body || {};
      if (!kind || !externalId || !title) return res.status(400).json({ message: "kind, externalId, title required" });
      const row = await storage.upsertRating(req.user!.id, {
        kind, externalId, title, signal: 0,
        meta: meta ? (typeof meta === "string" ? meta : JSON.stringify(meta)) : null,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/bookmarks/:kind/:externalId", requireAuth, async (req, res) => {
    const r = await storage.removeRating(req.user!.id, req.params.kind, decodeURIComponent(req.params.externalId));
    res.json(r);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Finance insights
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/finance-insights", optionalAuth, async (req, res) => {
    const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
    const userId = req.user?.id;
    try {
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

      const holdingsList: any[] = portfolio.holdings || portfolio.plaid?.holdings || [];
      const totalValue = Number(portfolio.totalValue || portfolio.plaid?.totalValue || holdingsList.reduce((s, h) => s + (h.value || 0), 0)) || 0;
      const insights: Array<{ kind: string; severity: "info" | "watch" | "alert"; title: string; detail: string }> = [];

      const sorted = [...holdingsList].sort((a, b) => (b.value || 0) - (a.value || 0));
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

      const movers = [...holdingsList]
        .filter((h) => Math.abs(h.dayChangePct || 0) >= 3 && (h.value || 0) >= 10)
        .sort((a, b) => Math.abs(b.dayChangePct || 0) - Math.abs(a.dayChangePct || 0))
        .slice(0, 3);
      for (const m of movers) {
        const up = (m.dayChangePct || 0) > 0;
        insights.push({
          kind: "mover", severity: "info",
          title: `${m.ticker} ${up ? "+" : ""}${(m.dayChangePct || 0).toFixed(1)}% today`,
          detail: `${m.name || m.ticker} — ${up ? "moved up" : "pulled back"} on a position worth $${(m.value || 0).toFixed(0)}.`,
        });
      }

      const losers = [...holdingsList]
        .filter((h) => (h.gainPct || 0) <= -50 && (h.value || 0) >= 50)
        .sort((a, b) => (a.gainPct || 0) - (b.gainPct || 0))
        .slice(0, 2);
      for (const l of losers) {
        insights.push({
          kind: "loser", severity: "watch",
          title: `${l.ticker} is down ${Math.round(l.gainPct || 0)}% on cost`,
          detail: `Currently $${(l.value || 0).toFixed(0)} vs cost basis $${(l.costBasis || 0).toFixed(0)}. Consider tax-loss harvesting if you're done waiting.`,
        });
      }

      const subs = userId ? await storage.listSubscriptions(userId).catch(() => [] as any[]) : [];
      const monthlySubs = subs.reduce((s, x) => s + (x.cadence === "yearly" ? (x.amount || 0) / 12 : x.cadence === "weekly" ? (x.amount || 0) * 4.33 : (x.amount || 0)), 0);
      if (monthlySubs > 0 && totalValue > 0) {
        const yieldNeeded = ((monthlySubs * 12) / totalValue) * 100;
        insights.push({
          kind: "sub-yield",
          severity: yieldNeeded > 8 ? "watch" : "info",
          title: `Subscriptions cost ${yieldNeeded.toFixed(1)}% of portfolio per year`,
          detail: `$${monthlySubs.toFixed(2)}/mo × 12 = $${(monthlySubs * 12).toFixed(0)}/yr. Your portfolio would need a ${yieldNeeded.toFixed(1)}% return just to cover them.`,
        });
      }

      const dust = holdingsList.filter((h) => (h.value || 0) < 1 && (h.value || 0) > 0).length;
      if (dust >= 5) {
        insights.push({
          kind: "dust", severity: "info",
          title: `${dust} dust positions under $1`,
          detail: "Tiny fractional holdings (likely from a round-up app) add clutter without exposure. Consider consolidating.",
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

/* ============ Price helpers ============ */

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
