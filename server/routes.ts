import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storage } from "./storage";
import { insertRatingSchema, insertHoldingSchema, insertWatchlistSchema, insertSubscriptionSchema, insertFoodSpotSchema, insertRecFeedbackSchema, insertUserItemSchema } from "@shared/schema";
import * as Spotify from "./spotify";
import * as Google from "./google";
import * as Plaid from "./plaid";
import { seedCatalog, type CatalogItem } from "./catalog-seed";
import { seedEvents, type SeedEvent } from "./events-seed";
import { requireAuth, optionalAuth, setSessionCookie, clearSessionCookie } from "./auth";
import { fetchAtlasPathsForUser, atlasShareUrl, atlasServerConfigured, atlasBaseUrl, exchangeAtlasCode, invalidateAtlasCache } from "./atlas";
import { randomUUID } from "node:crypto";
import { makeCache, TTL } from "./cache";
import {
  analyzeSeries,
  scoreToLabel,
  type SeriesAnalysis,
  type SignalReason,
  type Factors,
} from "./finance/indicators";
import {
  SECTOR_UNIVERSE as SECTOR_UNIVERSE_SHARED,
  SYMBOL_TO_SECTOR_CURATED as SYMBOL_TO_SECTOR_CURATED_SHARED,
  ETF_SECTOR_HINTS as ETF_SECTOR_HINTS_SHARED,
  isCryptoSymbol,
  normalizeYahooSector as normalizeYahooSectorShared,
  yahooSymbol as yahooSymbolShared,
  computeOptimalAllocation,
  CANONICAL_SECTORS,
} from "./finance/sectors";

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

  // ── Demo Atlas link ─────────────────────────────────────────────────────────────
  // Seed user_id=1 (the QA/demo user) with Jay's real Atlas cuid so the
  // built-in demo flow keeps showing paths without needing the consent
  // dance. Idempotent — upsert is a no-op if the row already exists with
  // these values.
  try {
    const demoAtlasUserId = "cmo8acnpz000001plt4af7fpe";
    const existing = await storage.getAtlasLink(1);
    if (!existing) {
      await storage.upsertAtlasLink(1, demoAtlasUserId, "jay", "Jay Thomas");
      console.log("[atlas] seeded demo Atlas link for user_id=1");
    }
  } catch (e: any) {
    console.warn("[atlas] demo seed skipped:", e.message);
  }

  // ── Demo Saved bookmarks ──────────────────────────────────────
  // Bookmarks live in the ratings table with signal=0 (watchlist). Seed a
  // handful for user_id=1 so the Saved page shows a populated shortlist out
  // of the box. Idempotent — skip if the user already has any bookmarks.
  try {
    const ratings = await storage.listRatings(1);
    const hasBookmark = ratings.some((r) => r.signal === 0);
    if (!hasBookmark) {
      const demoBookmarks: Array<{ kind: string; externalId: string; title: string; meta?: any }> = [
        { kind: "place", externalId: "demo-bishop-museum", title: "Bishop Museum", meta: { city: "Honolulu", subtitle: "State museum of Hawaiian + Pacific culture" } },
        { kind: "place", externalId: "demo-lanikai-pillbox", title: "Lanikai Pillbox Hike", meta: { city: "Honolulu", subtitle: "Short, steep climb to a turquoise overlook" } },
        { kind: "event", externalId: "demo-chris-botti", title: "Chris Botti", meta: { city: "Honolulu", subtitle: "Blue Note Hawaii · May 25" } },
        { kind: "show", externalId: "demo-slow-horses", title: "Slow Horses", meta: { year: 2022, subtitle: "MI5's rejects, led by a slovenly Gary Oldman" } },
        { kind: "film", externalId: "demo-tinker-tailor", title: "Tinker Tailor Soldier Spy", meta: { year: 2011, subtitle: "Le Carré adaptation" } },
      ];
      for (const b of demoBookmarks) {
        await storage.upsertRating(1, {
          kind: b.kind,
          externalId: b.externalId,
          title: b.title,
          signal: 0,
          meta: b.meta ? JSON.stringify(b.meta) : null,
        } as any);
      }
      console.log(`[demo] seeded ${demoBookmarks.length} Saved bookmarks for user_id=1`);
    }
  } catch (e: any) {
    console.warn("[demo] bookmarks seed skipped:", e.message);
  }

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

      // 1) Match by Spotify ID first.
      let user = await storage.getUserBySpotifyId(profile.id);

      // 2) If not found and we have an email, try linking to an existing
      //    user with the same email (e.g. a Google-linked account). This
      //    keeps the same DB user across Google + Spotify sign-ins so
      //    Plaid items, holdings, and watchlists all stay attached.
      if (!user && profile.email) {
        const existing = await storage.getUserByEmail(profile.email);
        if (existing) {
          user = await storage.updateUser(existing.id, { spotifyId: profile.id });
        }
      }

      // 3) Otherwise create a brand new user.
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

  // ──────────────────────────────────────────────────────────────────────────
  // Auth — Google OAuth as alternative login
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/auth/google/login", (_req, res) => {
    const cfg = Google.getAppConfig();
    if (!cfg) {
      return res.status(500).json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
    }
    const state = randomUUID();
    pendingStates.set(state, Date.now());
    const url = Google.buildAuthorizeUrl(state);
    res.redirect(url);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const err = req.query.error as string | undefined;

    if (err) return res.status(400).send(`Google authorization denied: ${err}`);
    if (!code) return res.status(400).send("Missing authorization code");
    if (!state || !pendingStates.has(state)) {
      return res.status(400).send("Invalid or expired state parameter");
    }
    pendingStates.delete(state);

    try {
      const tok = await Google.exchangeCodeForToken(code);
      const profile = await Google.getMe(tok.access_token);

      // 1) Match by Google sub first.
      let user = await storage.getUserByGoogleId(profile.sub);

      // 2) If not found and email is verified, try linking to an existing
      //    user with the same email (e.g. a Spotify-linked account).
      if (!user && profile.email && profile.email_verified !== false) {
        const existing = await storage.getUserByEmail(profile.email);
        if (existing) {
          user = await storage.updateUser(existing.id, { googleId: profile.sub });
        }
      }

      // 3) Otherwise create a brand new user.
      if (!user) {
        user = await storage.createUser({
          googleId: profile.sub,
          email: profile.email,
          displayName: profile.name || profile.given_name,
          avatarUrl: profile.picture,
        });
      }

      const session = await storage.createSession(user.id);
      setSessionCookie(res, session.id, session.expiresAt);

      res.redirect("/#/");
    } catch (e: any) {
      console.error("[google-callback]", e.message);
      res.status(500).send(`Authentication failed: ${e.message}`);
    }
  });

  app.get("/api/auth/me", optionalAuth, (req, res) => {
    if (!req.user) return res.json({ user: null });
    const { id, displayName, email, avatarUrl, spotifyId, googleId, createdAt, onboardingCompleted } = req.user as any;
    res.json({ user: { id, displayName, email, avatarUrl, spotifyId, googleId, createdAt, onboardingCompleted: !!onboardingCompleted } });
  });

  app.post("/api/auth/onboarding-completed", requireAuth, async (req, res) => {
    await storage.updateUser(req.user!.id, { onboardingCompleted: 1 });
    res.json({ ok: true });
  });

  /**
   * Onboarding checklist status — used by the Home page to show a
   * first-run checklist that disappears once the user has set everything up.
   * Each step is derived from real state, not stored as a flag.
   */
  app.get("/api/onboarding-status", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const u = req.user as any;
      const [plaidItems, holdings, watchlist, foodSpots] = await Promise.all([
        storage.getPlaidItems(userId).catch(() => []),
        storage.listHoldings(userId).catch(() => []),
        storage.listWatchlist(userId).catch(() => []),
        storage.listFoodSpots(userId).catch(() => []),
      ]);
      const steps = [
        { id: "account", label: "Sign in", done: true },
        { id: "spotify", label: "Connect Spotify", done: !!u.spotifyId, href: "/music" },
        { id: "brokerage", label: "Connect a brokerage", done: plaidItems.length > 0, href: "/finance" },
        {
          id: "first-touch",
          label: "Add something you care about",
          done: (holdings.length + watchlist.length + foodSpots.length) > 0,
          href: "/saved",
        },
        { id: "dismiss", label: "You're set up", done: !!u.onboardingCompleted },
      ];
      const completedCount = steps.filter(s => s.done).length;
      res.json({
        steps,
        completedCount,
        totalCount: steps.length,
        hidden: !!u.onboardingCompleted,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /**
   * Export everything Radius has stored about the signed-in user as one
   * JSON document. Used by Settings > Export my data. Plaid access tokens
   * are redacted; only institution names are exposed.
   */
  app.get("/api/auth/export", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const [plaidItems, holdings, watchlist, subscriptions, foodSpots, ratings, userItems, recFeedback] = await Promise.all([
        storage.getPlaidItems(userId).catch(() => []),
        storage.listHoldings(userId).catch(() => []),
        storage.listWatchlist(userId).catch(() => []),
        storage.listSubscriptions(userId).catch(() => []),
        storage.listFoodSpots(userId).catch(() => []),
        storage.listRatings(userId).catch(() => []),
        storage.listUserItems(userId).catch(() => []),
        storage.listRecFeedback(userId).catch(() => []),
      ]);
      const u = req.user as any;
      const payload = {
        exportedAt: new Date().toISOString(),
        appVersion: "v0.4",
        user: {
          id: u.id, displayName: u.displayName, email: u.email,
          avatarUrl: u.avatarUrl, createdAt: u.createdAt,
          spotifyConnected: !!u.spotifyId, googleConnected: !!u.googleId,
        },
        connections: {
          plaidItems: plaidItems.map((p: any) => ({
            id: p.id, institutionName: p.institutionName, createdAt: p.createdAt,
          })),
        },
        holdings, watchlist, subscriptions, foodSpots, ratings, userItems, recFeedback,
      };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="radius-export-${new Date().toISOString().slice(0,10)}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /**
   * Permanently delete the signed-in user and all of their data.
   * Also clears the session cookie.
   */
  app.delete("/api/auth/account", requireAuth, async (req, res) => {
    try {
      const r = await storage.deleteUserAndAllData(req.user!.id);
      clearSessionCookie(res);
      res.json({ ok: true, changes: r.changes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
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
    const token = await Plaid.getInflightLinkToken(req.user!.id);
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
      await Plaid.clearInflightLinkToken(req.user!.id);
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
            // Transform raw Plaid response into the shape the frontend
            // expects. Plaid returns holdings keyed by security_id (no
            // ticker/name) + a separate securities[] list — we have to
            // join them and compute dayChangePct + gainPct ourselves.
            // Without this transform, every field on the frontend ends
            // up undefined and `.toFixed` crashes the whole page.
            const secById = new Map<string, any>();
            for (const s of allSecurities) secById.set(s.security_id, s);

            // Per Plaid docs: cost_basis is the average cost per share
            // (NOT total). Total cost = cost_basis * quantity. cost_basis
            // can be null when the institution doesn't supply it (common
            // for crypto, some brokerages). Track which holdings have a
            // real cost so we can compute portfolio-level gain ONLY over
            // the cost-known subset — mixing unknown-cost rows into the
            // total dilutes the aggregate toward nonsense (which was the
            // –64.52% bug).
            const normalizedHoldings: any[] = allHoldings.map((h: any) => {
              const sec = secById.get(h.security_id) || {};
              const ticker = sec.ticker_symbol || sec.proxy_security_id || sec.security_id || "—";
              const name = sec.name || ticker;
              const quantity = Number(h.quantity) || 0;
              const price = Number(h.institution_price ?? sec.close_price ?? 0) || 0;
              const value = Number(h.institution_value ?? (quantity * price)) || 0;

              // cost_basis is per-share. Only treat it as known if Plaid
              // actually returned a non-null, positive number.
              const rawCostBasis = h.cost_basis;
              const hasCostBasis = rawCostBasis != null && Number(rawCostBasis) > 0 && quantity > 0;
              const totalCost = hasCostBasis ? Number(rawCostBasis) * quantity : null;

              const prevClose = Number(sec.close_price ?? 0);
              const dayChangePct = prevClose > 0 && price > 0 && price !== prevClose
                ? ((price - prevClose) / prevClose) * 100
                : 0;

              const gainPct = totalCost != null && totalCost > 0
                ? ((value - totalCost) / totalCost) * 100
                : 0;

              return {
                ticker, name, value, dayChangePct, gainPct, quantity, price,
                _cost: totalCost, // internal — used for aggregate, stripped before send
              };
            });

            // Aggregate over ALL holdings for value/dayChange,
            // but ONLY over cost-known holdings for totalGain.
            const totalValue = normalizedHoldings.reduce((s, h) => s + h.value, 0);
            const costKnown = normalizedHoldings.filter(h => h._cost != null);
            const costKnownValue = costKnown.reduce((s, h) => s + h.value, 0);
            const costKnownCost = costKnown.reduce((s, h) => s + h._cost, 0);
            const totalGain = costKnownCost > 0 ? costKnownValue - costKnownCost : 0;
            const totalGainPct = costKnownCost > 0 ? (totalGain / costKnownCost) * 100 : 0;
            const dayChange = normalizedHoldings.reduce((s, h) => s + (h.value * (h.dayChangePct / 100)), 0);
            const dayChangePct = totalValue > 0 && totalValue !== dayChange
              ? (dayChange / (totalValue - dayChange)) * 100
              : 0;

            // Strip the internal _cost field before shipping to client
            for (const h of normalizedHoldings) delete h._cost;

            plaidData = {
              totalValue,
              dayChange,
              dayChangePct,
              totalGain,
              totalGainPct,
              positions: normalizedHoldings.length,
              holdings: normalizedHoldings,
              source: "plaid-live",
            };
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

    // Live mode: only show real Plaid data. No snapshot fallback — if the
    // user has no brokerages connected, show $0, not the legacy demo
    // snapshot. The snapshot is only used in demo mode AND for anonymous
    // visitors who haven't signed in yet.
    const effectivePlaid =
      plaidData ??
      (mode === "demo" ? snapshot : (!userId ? snapshot : null));

    const source =
      plaidData ? "plaid-live" :
      mode === "demo" ? "demo" :
      !userId ? "preview" :
      manual.length ? "manual" :
      "empty";

    res.json({
      source,
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
      // New genre-rollup sections — Music page redesign
      else if (section === "recent-genre") snap = await Spotify.getRecentByGenre(userId, 50);
      else if (section === "rotation-genre") snap = await Spotify.getRotationByGenre(userId, 50);
      else if (section === "followed-artists") snap = await Spotify.getFollowedArtistsWithGenres(userId, 20);
      else if (section === "upcoming-releases") snap = await Spotify.getUpcomingReleases(userId, { limit: 12, daysBack: 30 });
      else snap = await Spotify.getRecentlyPlayed(userId, 20);

      // Genre/artist sections — no per-track reranking, return as-is.
      if (section === "recent-genre" || section === "rotation-genre" || section === "followed-artists" || section === "upcoming-releases") {
        return res.json(snap);
      }

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
  // Music Mood — Claude-derived mood from your listening genres
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Why this exists:
  //   Spotify deprecated /audio-features for new apps (Nov 2024) and even on
  //   existing apps it's flaky. We synthesize a mood from the user's recent
  //   genre rollup by asking Claude to score it on valence/energy.
  //
  // Output shape (kept tight — a stock-ticker style strip consumes it):
  //   {
  //     score:  0..100,          // composite mood index
  //     valence: 0..100,         // happy ↔ somber
  //     energy:  0..100,         // calm ↔ intense
  //     label:   "Mellow Drift", // 1-3 word vibe label
  //     delta:   number,         // vs prior cached score (− or +)
  //     drivers: string[],       // 3-5 genres that pulled the score
  //     asOf:    ISO string,
  //   }
  //
  // Cache: per-user, TTL 6h. Mood doesn't shift hour to hour.

  const moodCache = makeCache<any>("music-mood", { ttlMs: TTL.HOUR_6, maxEntries: 10000 });

  app.get("/api/music-mood", optionalAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";

      // Demo: deterministic mellow-reggae fixture so the UI demos cleanly.
      if (mode === "demo" || !userId) {
        return res.json({
          source: "demo",
          score: 64, valence: 71, energy: 52,
          label: "Sun-Warmed Drift",
          delta: +3,
          drivers: ["Reggae", "Hip-Hop", "Indie", "EDM"],
          asOf: new Date().toISOString(),
        });
      }

      const st = await Spotify.userStatus(userId);
      if (!st.authorized) {
        return res.json({ source: "unauthorized", reason: "connect-spotify" });
      }

      // Cache hit?
      const moodKey = String(userId);
      const hit = req.query.refresh ? undefined : moodCache.peek(moodKey);
      if (hit) {
        return res.json(hit);
      }

      // Pull recent + rotation genre rollups in parallel — they're our signal.
      const [recent, rotation] = await Promise.all([
        Spotify.getRecentByGenre(userId, 50).catch(() => ({ genres: [] as any[] })),
        Spotify.getRotationByGenre(userId, 50).catch(() => ({ genres: [] as any[] })),
      ]);

      type GBucket = { genre: string; count: number };
      const recentGenres: GBucket[] = (recent.genres || []).map((g: any) => ({ genre: g.genre, count: g.count }));
      const rotationGenres: GBucket[] = (rotation.genres || []).map((g: any) => ({ genre: g.genre, count: g.count }));

      if (!recentGenres.length && !rotationGenres.length) {
        return res.json({ source: "no-data", reason: "no-listening-history" });
      }

      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const claudeCopyOn = process.env.RADIUS_CLAUDE_COPY === "1";
      if (!anthropicKey || !claudeCopyOn) {
        // Default path: deterministic heuristic. Claude is opt-in via
        // RADIUS_CLAUDE_COPY=1 — keeps tone consistent and saves credits.
        const top = [...rotationGenres, ...recentGenres].slice(0, 5).map(g => g.genre);
        return res.json({
          source: "heuristic",
          score: 55, valence: 55, energy: 55,
          label: "Steady Rotation",
          delta: 0,
          drivers: top,
          asOf: new Date().toISOString(),
        });
      }

      const system = `You score a person's musical mood from their recent listening genres.
Output STRICT JSON only — no prose, no markdown fences.
Shape: { "valence": 0-100, "energy": 0-100, "label": "1-3 word vibe", "drivers": ["genre", ...3-5 items] }
- valence: 0 = somber/melancholic, 100 = euphoric/joyful
- energy: 0 = calm/ambient, 100 = intense/aggressive
- label: a poetic, evocative 1-3 word phrase capturing the vibe (e.g. "Sun-Warmed Drift", "Edgewise Burn", "Late Velvet")
- drivers: the 3-5 input genres that most shaped your score, in descending influence
Do not invent genres not in the input.`;

      const userMsg = `Recent listening (last ~50 plays, by genre count):\n${recentGenres.slice(0,8).map(g => `- ${g.genre}: ${g.count}`).join("\n") || "  (none)"}\n\nOn rotation (top tracks short-term, by genre count):\n${rotationGenres.slice(0,8).map(g => `- ${g.genre}: ${g.count}`).join("\n") || "  (none)"}\n\nReturn JSON only.`;

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 250,
          system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });

      if (!r.ok) {
        const errText = await r.text();
        console.warn("[music-mood] Claude error:", errText.slice(0, 200));
        // Fall back to heuristic so UI never sees a hard fail.
        const top = [...rotationGenres, ...recentGenres].slice(0, 5).map(g => g.genre);
        return res.json({
          source: "heuristic-fallback",
          score: 55, valence: 55, energy: 55,
          label: "Steady Rotation",
          delta: 0,
          drivers: top,
          asOf: new Date().toISOString(),
        });
      }

      const j: any = await r.json();
      const raw = j.content?.[0]?.text || "";
      // Strip code fences if Claude added any.
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      let parsed: any;
      try { parsed = JSON.parse(cleaned); } catch {
        // Try grabbing the first {...} block.
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
      }
      if (!parsed || typeof parsed.valence !== "number" || typeof parsed.energy !== "number") {
        const top = [...rotationGenres, ...recentGenres].slice(0, 5).map(g => g.genre);
        return res.json({
          source: "parse-fallback",
          score: 55, valence: 55, energy: 55,
          label: "Steady Rotation",
          delta: 0,
          drivers: top,
          asOf: new Date().toISOString(),
        });
      }

      const valence = Math.max(0, Math.min(100, Math.round(parsed.valence)));
      const energy = Math.max(0, Math.min(100, Math.round(parsed.energy)));
      const score = Math.round((valence + energy) / 2);
      const prior = hit?.payload?.score;
      const delta = typeof prior === "number" ? score - prior : 0;

      const payload = {
        source: "claude",
        score, valence, energy,
        label: String(parsed.label || "Mixed").slice(0, 24),
        delta,
        drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 5).map((s: any) => String(s).slice(0, 24)) : [],
        asOf: new Date().toISOString(),
      };

      moodCache.set(moodKey, payload);
      res.json(payload);
    } catch (e: any) {
      console.error("music-mood error:", e.message);
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
  // Atlas paths — per-user read-only mirror of paths logged in the sibling app
  // ══════════════════════════════════════════════════════════════════════════

  app.get("/api/paths", requireAuth, async (req, res) => {
    try {
      const force = req.query.refresh === "1";
      const link = await storage.getAtlasLink(req.user!.id);
      const serverConfigured = atlasServerConfigured();
      const baseUrl = serverConfigured ? atlasBaseUrl() : null;

      // No link → user hasn't connected Atlas yet. Surface as an empty,
      // "connect me" state. `linked: false` is what the client checks.
      if (!link) {
        return res.json({
          paths: [],
          source: "unlinked",
          linked: false,
          configured: serverConfigured,
          atlasBaseUrl: baseUrl,
        });
      }

      const { paths, source } = await fetchAtlasPathsForUser(link.atlasUserId, { force });
      const withShare = paths.map((p) => ({
        ...p,
        atlasShareUrl: atlasShareUrl(p.shareSlug),
      }));
      res.json({
        paths: withShare,
        source,
        linked: true,
        configured: serverConfigured,
        atlasBaseUrl: baseUrl,
        atlasUsername: link.atlasUsername,
        atlasName: link.atlasName,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message, paths: [], source: "error" });
    }
  });

  // ── Atlas OAuth-style consent flow ─────────────────────────────────────
  // GET /api/atlas/connect → redirect to Atlas /connect/radius
  // GET /api/atlas/callback?code=... → exchange + persist link, redirect to /#/places
  // DELETE /api/atlas/link → disconnect

  app.get("/api/atlas/connect", requireAuth, async (_req, res) => {
    if (!atlasServerConfigured()) {
      return res.status(503).send("Atlas integration is not configured on the server.");
    }
    const target = `${atlasBaseUrl()}/connect/radius`;
    res.redirect(target);
  });

  app.get("/api/atlas/callback", requireAuth, async (req, res) => {
    const code = (req.query.code as string | undefined)?.trim();
    const err = (req.query.error as string | undefined)?.trim();
    if (err) {
      return res.redirect(`/#/places?atlas_error=${encodeURIComponent(err)}`);
    }
    if (!code) {
      return res.redirect("/#/places?atlas_error=missing_code");
    }
    try {
      const result = await exchangeAtlasCode(code);
      if (!result) {
        return res.redirect("/#/places?atlas_error=exchange_failed");
      }
      await storage.upsertAtlasLink(
        req.user!.id,
        result.atlasUserId,
        result.atlasUsername,
        result.atlasName
      );
      // Bust the cache for this Atlas userId so the first /api/paths hit
      // after linking returns fresh data.
      invalidateAtlasCache(result.atlasUserId);
      res.redirect("/#/places?atlas_connected=1");
    } catch (e: any) {
      console.error("[atlas] callback failed:", e.message);
      res.redirect(`/#/places?atlas_error=${encodeURIComponent("server_error")}`);
    }
  });

  app.delete("/api/atlas/link", requireAuth, async (req, res) => {
    try {
      const link = await storage.getAtlasLink(req.user!.id);
      const r = await storage.deleteAtlasLink(req.user!.id);
      if (link) invalidateAtlasCache(link.atlasUserId);
      res.json({ ok: true, changes: r.changes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // City search — Photon (Komoot) geocoder proxy
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Photon is free, no API key, no rate limit drama. Returns OSM places.
  // We proxy to:
  //   1) avoid client-side CORS
  //   2) filter to actual settlements (skip counties, farms, residential blocks)
  //   3) cache hot queries for 1h (most users type the same big cities)
  //
  // Response shape — a flat array of city suggestions:
  //   [{ name: "Honolulu", region: "Hawaii", country: "United States",
  //     cc: "US", display: "Honolulu, Hawaii, United States",
  //     lat: 21.30, lon: -157.86 }, ...]

  const citySearchCache = makeCache<any[]>("city-search", { ttlMs: TTL.HOUR_1, maxEntries: 500 });
  const CITY_TYPES = new Set(["city", "town", "village", "suburb", "neighbourhood", "municipality", "locality"]);

  app.get("/api/places/city-search", async (req, res) => {
    try {
      const q = (req.query.q as string | undefined)?.trim() || "";
      if (q.length < 2) return res.json({ items: [] });

      const key = q.toLowerCase();
      const cached = citySearchCache.peek(key);
      if (cached) {
        return res.json({ items: cached, cached: true });
      }

      // limit=15 because we filter aggressively below; final UI shows ~8.
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=15&lang=en`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) {
        return res.json({ items: [], error: `geocoder ${r.status}` });
      }
      const data: any = await r.json();
      const feats: any[] = Array.isArray(data?.features) ? data.features : [];

      const items = feats
        .map((f) => {
          const p = f.properties || {};
          const coords = f.geometry?.coordinates || [];
          return {
            name: p.name as string,
            region: (p.state || p.county || "") as string,
            country: (p.country || "") as string,
            cc: (p.countrycode || "") as string,
            osmValue: p.osm_value as string,
            lat: typeof coords[1] === "number" ? coords[1] : undefined,
            lon: typeof coords[0] === "number" ? coords[0] : undefined,
          };
        })
        .filter((x) => x.name && CITY_TYPES.has(x.osmValue))
        // De-dupe by name+region+country so "Honolulu, Hawaii, US" doesn't appear twice.
        .filter((x, i, arr) => arr.findIndex((y) => y.name === x.name && y.region === x.region && y.country === x.country) === i)
        .slice(0, 8)
        .map((x) => ({
          name: x.name,
          region: x.region,
          country: x.country,
          cc: x.cc,
          display: [x.name, x.region, x.country].filter(Boolean).join(", "),
          lat: x.lat,
          lon: x.lon,
        }));

      citySearchCache.set(key, items);
      res.json({ items });
    } catch (e: any) {
      console.warn("[city-search] error:", e?.message);
      res.json({ items: [], error: e?.message || "unknown" });
    }
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

    // Deduplicate: same Ticketmaster event can return for multiple artist queries
    // (e.g. 'Mariah the Scientist' shows up for both 'Mariah' and the headliner).
    // Key by URL (most stable) then fall back to name+date+venue.
    const seenConcerts = new Set<string>();
    const dedupedConcerts = concerts.filter((c: any) => {
      const k = (c.url || `${c.name || ""}|${c.date || ""}|${c.venue || ""}`).toLowerCase();
      if (seenConcerts.has(k)) return false;
      seenConcerts.add(k);
      return true;
    });

    const effectiveUserId = userId ?? 0;
    const { items: ranked, learning } = await rerankWithFeedback(
      dedupedConcerts, effectiveUserId, "concert",
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

    // Collect transactions from the right source.
    // - demo mode: fixture file
    // - live mode: real Plaid transactions for this user's items, falling
    //   back to the snapshot file only if the user has no Plaid items
    //   connected yet.
    type Tx = { merchant: string; date: string; amount: number; category: string };
    let txs: Tx[] = [];
    let txSource = "snapshot";

    if (mode === "demo") {
      const snap = loadSnapshot<any>("transactions-snapshot-demo.json");
      txs = (snap?.transactions ?? []).map((t: any) => ({
        merchant: t.merchant, date: t.date, amount: t.amount, category: t.category,
      }));
      txSource = "demo-fixture";
    } else if (userId) {
      try {
        const items = await storage.getPlaidItems(userId);
        if (items.length > 0) {
          const endDate = new Date();
          const startDate = new Date(endDate.getTime() - 90 * 86400000);
          const fmt = (d: Date) => d.toISOString().slice(0, 10);
          const collected: Tx[] = [];
          for (const item of items) {
            try {
              const data: any = await Plaid.getTransactions(item.accessToken, fmt(startDate), fmt(endDate));
              for (const t of data.transactions || []) {
                // Plaid amounts are positive for debits (money out).
                // Skip credits (refunds, deposits) and unusually large purchases.
                if (!t.amount || t.amount <= 0 || t.amount > 500) continue;
                const merchant = (t.merchant_name || t.name || "").trim();
                if (!merchant) continue;
                collected.push({
                  merchant,
                  date: t.date,
                  amount: t.amount,
                  category: (t.personal_finance_category?.primary || t.category?.[0] || "").toString(),
                });
              }
            } catch (e: any) {
              console.warn("[subscriptions] Plaid getTransactions failed for item", item.id, e?.message || e);
            }
          }
          if (collected.length > 0) {
            txs = collected;
            txSource = "plaid-live";
          }
        }
      } catch (e: any) {
        console.warn("[subscriptions] Plaid items lookup failed", e?.message || e);
      }
      // Fallback to live snapshot if no Plaid items or all calls failed
      if (txs.length === 0) {
        const snap = loadSnapshot<any>("transactions-snapshot.json");
        txs = (snap?.transactions ?? []).map((t: any) => ({
          merchant: t.merchant, date: t.date, amount: t.amount, category: t.category,
        }));
        txSource = "snapshot-fallback";
      }
    }

    const detected: any[] = [];
    if (txs.length > 0) {
      const byMerchant = new Map<string, { dates: string[]; amounts: number[]; category: string }>();
      // In live (Plaid) mode we don't filter by category since Plaid's
      // taxonomy is granular — we instead rely on the recurring-cadence
      // heuristic below to identify subscriptions. In demo we keep the
      // original tight "Subscription" filter.
      const restrictCategory = txSource === "demo-fixture" || txSource === "snapshot-fallback";
      for (const t of txs) {
        if (restrictCategory && t.category !== "Subscription") continue;
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
          // Subscription cadence detection: tolerate ±4 days on each band.
          // If gaps don't match any expected cadence, skip — this filters
          // out one-off purchases at recurring merchants (e.g. groceries).
          let cadence: "weekly" | "monthly" | "yearly" | null = null;
          if (avgGap >= 25 && avgGap <= 35) cadence = "monthly";
          else if (avgGap >= 6 && avgGap <= 8) cadence = "weekly";
          else if (avgGap >= 350 && avgGap <= 380) cadence = "yearly";
          if (!cadence) continue;

          // Also require amounts to be roughly consistent (within 15%)
          // to filter out variable-amount merchants.
          const avgAmount = info.amounts.reduce((a, b) => a + b, 0) / info.amounts.length;
          const maxDev = Math.max(...info.amounts.map(a => Math.abs(a - avgAmount) / avgAmount));
          if (maxDev > 0.15 && txSource === "plaid-live") continue;

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
    res.json({
      detected,
      manual,
      all: [...detected, ...manual],
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      source: txSource,
    });
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

  // Sentiment: pure math lives in server/finance/indicators.ts and is unit-tested.
  // This route adapts the analysis to the wire format (adds `symbol`) and caches
  // the result for 5 minutes per `(symbol, weeks)`.
  type SentimentResult = SeriesAnalysis & { symbol: string };
  const sentimentCache = makeCache<SentimentResult>("sentiment", {
    ttlMs: TTL.MIN_5,
    maxEntries: 2000,
  });

  async function fetchSentiment(symbol: string, weeks: number): Promise<SentimentResult> {
    return sentimentCache.getOrSet(`${symbol}:${weeks}`, async () => {
      try {
        // Yahoo's `range` only accepts presets (1d, 5d, 1mo, 3mo, 6mo, 1y, ...).
        // Always fetch 1y of daily candles, then let analyzeSeries slice locally.
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!r.ok) throw new Error(`Yahoo ${r.status}`);
        const data = await r.json();
        const result = data?.chart?.result?.[0];
        if (!result) throw new Error("no result");
        const closesAll: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter(
          (c: any) => c != null
        );
        if (!closesAll.length) throw new Error("no closes");
        const tradingDays = Math.max(5, Math.round(weeks * 5));
        const latest = result.meta?.regularMarketPrice ?? undefined;
        const analysis = analyzeSeries(closesAll, tradingDays, latest);
        return { symbol, ...analysis };
      } catch {
        return {
          symbol,
          currentPrice: null,
          returnPct: null,
          sentiment: 0,
          label: "Hold" as const,
          reasons: [],
          factors: {
            momentum: null,
            trend: null,
            drawdown: null,
            rsi: null,
            rsiSignal: null,
            volatilityPct: null,
            sharpe: null,
          },
          action: "No data available.",
          conviction: 1 as const,
        };
      }
    });
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

  const chartCache = makeCache<ChartHistory>("chart-history", { ttlMs: TTL.MIN_5, maxEntries: 2000 });

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
    const cached = chartCache.peek(cacheKey);
    if (cached) return cached;

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
      chartCache.set(cacheKey, out);
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

  // Sector constants + symbol→sector lookup live in server/finance/sectors.ts.
  // Re-aliased here so the rest of routes.ts reads cleanly. The cache-backed
  // live lookup falls back to Yahoo's quoteSummary for off-curated symbols.
  const SECTOR_UNIVERSE = SECTOR_UNIVERSE_SHARED;
  const SYMBOL_TO_SECTOR_CURATED = SYMBOL_TO_SECTOR_CURATED_SHARED;
  const ETF_SECTOR_HINTS = ETF_SECTOR_HINTS_SHARED;
  const normalizeYahooSector = normalizeYahooSectorShared;
  const yahooSymbol = yahooSymbolShared;

  // 24h cache (per-process). On a cold miss for an off-curated symbol we
  // ask Yahoo's quoteSummary; if that fails, we cache "Other" for 1h so we
  // don't hammer the API on every page render.
  const sectorLookupCache = makeCache<string>("sector-lookup", {
    ttlMs: TTL.HOUR_24,
    maxEntries: 5000,
  });

  async function fetchSymbolSector(rawSym: string): Promise<string> {
    const sym = rawSym.toUpperCase().trim();
    if (!sym) return "Other";

    // 1. Curated map
    if (SYMBOL_TO_SECTOR_CURATED[sym]) return SYMBOL_TO_SECTOR_CURATED[sym];
    // 2. Known ETF / broad-market
    if (ETF_SECTOR_HINTS[sym]) return ETF_SECTOR_HINTS[sym];
    // 3. Crypto sniff
    if (isCryptoSymbol(sym)) return "Crypto";

    // 4. Cache-aside with Yahoo fallback
    return sectorLookupCache.getOrSet(sym, async () => {
      try {
        const r = await fetch(
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=assetProfile,quoteType`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!r.ok) throw new Error(`Yahoo ${r.status}`);
        const data = await r.json();
        const result = data?.quoteSummary?.result?.[0];
        const quoteType: string | undefined = result?.quoteType?.quoteType;
        const rawSector: string | undefined = result?.assetProfile?.sector;
        if (quoteType === "ETF" || quoteType === "MUTUALFUND") return "Broad Market";
        if (quoteType === "CRYPTOCURRENCY") return "Crypto";
        if (rawSector) return normalizeYahooSector(rawSector);
        return "Other";
      } catch {
        // Re-cache "Other" with a short TTL so we retry sooner than 24h.
        sectorLookupCache.set(sym, "Other", { ttlMs: TTL.HOUR_1 });
        return "Other";
      }
    });
  }

  app.post("/api/sector-lookup", async (req, res) => {
    const { symbols } = req.body || {};
    if (!Array.isArray(symbols)) return res.status(400).json({ message: "symbols array required" });
    const uniq = Array.from(new Set((symbols as string[]).map((s) => String(s).toUpperCase()).filter(Boolean)));
    try {
      const mapping = await Promise.all(
        uniq.map(async (sym) => ({ symbol: sym, sector: await fetchSymbolSector(sym) }))
      );
      const result: Record<string, string> = {};
      for (const m of mapping) result[m.symbol] = m.sector;
      res.json({ sectors: result });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

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
  // Optimal allocation across canonical sector lanes
  // ══════════════════════════════════════════════════════════════════════════

  // POST /api/optimal-allocation
  // body: { holdings: [{ symbol, value }], weeks }
  // Returns the SAME 6 canonical lanes as /api/sector-leaders so the donut and
  // the trophy cards line up visually and conceptually.
  app.post("/api/optimal-allocation", async (req, res) => {
    const { holdings, weeks: rawWeeks } = req.body || {};
    const weeks = Math.max(1, Math.min(52, parseInt(String(rawWeeks || 13), 10) || 13));
    if (!Array.isArray(holdings)) return res.status(400).json({ message: "holdings array required" });

    // 1. Resolve each holding to a canonical sector (or "Other"). This is the
    //    one I/O step that depends on per-symbol Yahoo lookups (cached 24h).
    const resolved = await Promise.all(
      (holdings as { symbol: string; value: number }[]).map(async (h) => ({
        symbol: String(h?.symbol || "").toUpperCase(),
        value: Number(h?.value),
        sector: await fetchSymbolSector(String(h?.symbol || "")),
      }))
    );

    // 2. Compute each canonical sector's return over the lookback. Average of
    //    the top-5 symbols in the curated universe (proxy for the sector ETF).
    const sectorReturns = await Promise.all(
      CANONICAL_SECTORS.map(async (name) => {
        const top = SECTOR_UNIVERSE[name].slice(0, 5);
        const rs = await Promise.all(
          top.map((s) => fetchSentiment(yahooSymbol(s, name), weeks).catch(() => null))
        );
        const valid = rs.filter((x) => x && x.returnPct != null) as { returnPct: number | null }[];
        if (!valid.length) return { name, returnPct: null as number | null, leader: null as string | null };
        const avg = valid.reduce((s, x) => s + (x.returnPct ?? 0), 0) / valid.length;
        let leaderSym: string | null = null;
        let leaderRet = -Infinity;
        for (let i = 0; i < rs.length; i++) {
          const r = rs[i];
          if (r && r.returnPct != null && r.returnPct > leaderRet) {
            leaderRet = r.returnPct;
            leaderSym = top[i];
          }
        }
        return { name, returnPct: avg, leader: leaderSym };
      })
    );

    // 3. Pure math — bucket holdings, build current/optimal weights, action chips.
    const allocation = computeOptimalAllocation(resolved, sectorReturns);
    res.json({ ...allocation, weeks });
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

  // AI-generated travel guide cache — keyed by lowercase city name.
  // TTL 24h so re-deploys don't blow the budget; curated entries bypass this entirely.
  const travelGuideCache = makeCache<TravelGuide>("travel-guide-ai", { ttlMs: TTL.HOUR_24, maxEntries: 200 });

  async function aiTravelGuide(city: string): Promise<TravelGuide | null> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;

    const cached = travelGuideCache.get(city.toLowerCase());
    if (cached) return cached;

    const system = `You are a knowledgeable travel editor. Return ONLY a valid JSON object — no markdown, no prose, no code fences. The schema is:
{
  "city": string,
  "sights": [{"name": string, "note": string, "url": string}],
  "neighborhoods": [{"name": string, "note": string}],
  "dayTrips": [{"name": string, "note": string, "distance": string}]
}
Rules: 5-6 sights, 4-5 neighborhoods, 3-4 day trips. Each note is 1 sentence, specific and evocative. URLs are real, well-known links (leave blank string if unsure). distance is driving time like "~45m" or "~2h".`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: `Generate a travel guide for: ${city}` }],
        }),
      });
      if (!r.ok) return null;
      const j: any = await r.json();
      const raw = (j.content?.[0]?.text || "").trim();
      // Strip any accidental code fences
      const cleaned = raw.replace(/^```[\w]*\n?|```$/g, "").trim();
      const raw_parsed: any = JSON.parse(cleaned);
      // Normalize snake_case or alternate key names the model might use
      const normalized: TravelGuide = {
        city: raw_parsed.city || city,
        sights: raw_parsed.sights || raw_parsed.attractions || [],
        neighborhoods: raw_parsed.neighborhoods || raw_parsed.districts || [],
        dayTrips: raw_parsed.dayTrips || raw_parsed.day_trips || raw_parsed.excursions || [],
      };
      // Must have at least something useful
      if (normalized.sights.length === 0 && normalized.neighborhoods.length === 0) return null;
      travelGuideCache.set(city.toLowerCase(), normalized);
      return normalized;
    } catch {
      return null;
    }
  }

  app.get("/api/travel-guide", optionalAuth, async (req, res) => {
    const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
    const key = city.toLowerCase();
    const curated = !!CURATED_GUIDES[key];
    // Use curated guide if available, otherwise try AI, fall back to generic stubs
    const guide = CURATED_GUIDES[key] || (await aiTravelGuide(city)) || genericGuide(city);
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

  // ══════════════════════════════════════════════════════════════════════════
  // TOP picks — one hero pick per domain, shown as a pill
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Strategy: heuristic picks the candidate from user data, then Claude
  // writes a single-sentence "why" (cached 12h per user+domain).
  //
  // Domains:
  //   stock   — highest-weight holding (live Plaid → manual fallback)
  //   artist  — most-played artist from Spotify short_term top tracks
  //   movie   — highest-rated unseen film candidate (TMDB trending ∩ not in ratings)
  //   show    — same as movie but kind === "show"
  //   place   — next upcoming Atlas path (or saved food spot)
  //   event   — next upcoming Ticketmaster event in user's city
  //
  // Response shape:
  //   { domain, title, subtitle?, image?, url?, why, source, asOf }
  //   { domain, source: "empty", reason } when no candidate available.

  type TopPick = {
    domain: string;
    title: string;
    subtitle?: string;
    image?: string;
    url?: string;
    why: string;
    source: string;
    asOf: string;
    // "high" — user-anchored or live-API candidate the client should surface
    // "low"  — editorial fallback (no user data yet). The pill hides these by
    //          default; pass ?showLowConfidence=1 to opt back in.
    confidence: "high" | "low";
  };
  const LOW_CONFIDENCE_SOURCES = new Set(["editorial"]);

  // cache key = `${userId}::${domain}`
  const topPickCache = makeCache<TopPick | { domain: string; source: string; reason?: string }>(
    "top-picks",
    { ttlMs: TTL.HOUR_12, maxEntries: 5000 }
  );

  async function claudeOneLiner(
    domain: string,
    candidate: { title: string; subtitle?: string; signal: string }
  ): Promise<string> {
    // Default to the deterministic heuristic reason. Claude is opt-in via
    // RADIUS_CLAUDE_COPY=1 — it sharpens the copy but adds latency, cost, and
    // tonal drift across pills. Keeping it off by default makes the product
    // sound like one designer wrote the strings, not an LLM filling in blanks.
    if (process.env.RADIUS_CLAUDE_COPY !== "1") return candidate.signal;
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return candidate.signal;

    const system = `You write a single-sentence personal recommendation reason. Output PLAIN TEXT only — no quotes, no markdown, no preamble. Max 14 words. Warm, specific, second-person ("because you…"). Reference the user's signal, not generic claims.`;
    const userMsg = `Domain: ${domain}\nPick: ${candidate.title}${candidate.subtitle ? " — " + candidate.subtitle : ""}\nWhy heuristic picked it: ${candidate.signal}\n\nWrite the one-sentence reason.`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 80,
          system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      if (!r.ok) return candidate.signal;
      const j: any = await r.json();
      const text = (j.content?.[0]?.text || "").trim().replace(/^["“]|["”]$/g, "");
      return text || candidate.signal;
    } catch {
      return candidate.signal;
    }
  }

  // Editorial fallbacks — curated defaults when the user has no data in a
  // domain (or a live API key is missing). The pill should never go dark.
  type FallbackCandidate = {
    title: string;
    subtitle?: string;
    image?: string;
    url?: string;
    signal: string;
    source: string;
  };
  function editorialFallback(domain: string, cityParam: string): FallbackCandidate | null {
    const city = cityParam || "your city";
    switch (domain) {
      case "stock":
        return {
          title: "SPY",
          subtitle: "S&P 500 ETF",
          url: "https://finance.yahoo.com/quote/SPY",
          signal: "add a holding to see your own top pick — SPY is the broad-market default",
          source: "editorial",
        };
      case "artist":
        return {
          title: "Connect Spotify",
          subtitle: "to surface your top artist",
          url: "#/settings",
          signal: "connect Spotify and we'll surface your most-played artist here",
          source: "editorial",
        };
      case "movie":
        return {
          title: "Seed your taste",
          subtitle: "in Watch → Catalog",
          url: "#/watch?tab=catalog",
          signal: "add a film you love to Catalog and we'll surface a fresh pick",
          source: "editorial",
        };
      case "show":
        return {
          title: "Seed your taste",
          subtitle: "in Watch → Catalog",
          url: "#/watch?tab=catalog",
          signal: "add a show you love to Catalog and we'll surface a fresh pick",
          source: "editorial",
        };
      case "place":
        return {
          title: `Explore ${city}`,
          subtitle: "top sights are below",
          url: "#/places",
          signal: `pin a place in ${city} to anchor your top pick here`,
          source: "editorial",
        };
      case "event":
        return {
          title: `Search ${city} events`,
          subtitle: "concerts, sports, arts",
          url: "#/events",
          signal: `events in ${city} will surface here once data is available`,
          source: "editorial",
        };
      default:
        return null;
    }
  }

  app.get("/api/top-picks", optionalAuth, async (req, res) => {
    try {
      const domain = (req.query.domain as string | undefined) || "";
      const validDomains = new Set(["stock", "artist", "movie", "show", "place", "event"]);
      if (!validDomains.has(domain)) {
        return res.status(400).json({ message: `Invalid domain. Use one of: ${[...validDomains].join(", ")}` });
      }

      const userId = req.user?.id;
      const mode = (req.query.mode as string | undefined) === "demo" ? "demo" : "live";
      const refresh = req.query.refresh === "1";
      // Optional city override — used by location-bound domains (place, event)
      // so the pill always reflects the city the user actually has selected,
      // not whichever city happens to sit at the top of their food-spots list.
      const cityParam = ((req.query.city as string | undefined) || "").trim();

      // ── Demo fallback fixtures so the UI looks alive without a connected account.
      if (mode === "demo" || !userId) {
        // For place/event, swap in the user's selected city so demo mode is also referential.
        const demoCity = cityParam || "Honolulu";
        const demo: Record<string, TopPick> = {
          stock: { domain, title: "NVDA", subtitle: "NVIDIA Corporation", why: "Your largest weighted position riding the AI buildout.", source: "demo", asOf: new Date().toISOString(), confidence: "high" },
          artist: { domain, title: "Stick Figure", subtitle: "Reggae", why: "Heaviest in your rotation this month.", source: "demo", asOf: new Date().toISOString(), confidence: "high" },
          movie: { domain, title: "Dune: Part Three", subtitle: "Sci-fi · 2026", why: "Tracks the slow-burn epics you've rated highly.", source: "demo", asOf: new Date().toISOString(), confidence: "high" },
          show: { domain, title: "Severance", subtitle: "Apple TV+", why: "Matches your taste for cerebral thrillers.", source: "demo", asOf: new Date().toISOString(), confidence: "high" },
          place: {
            domain,
            title: demoCity === "Honolulu" ? "Maku‘u Farmers Market" : `Iconic spot in ${demoCity}`,
            subtitle: demoCity === "Honolulu" ? "Pahoa, Hawaii" : demoCity,
            why: `Top of your saved places near ${demoCity}.`,
            source: "demo",
            asOf: new Date().toISOString(),
            confidence: "high",
          },
          event: {
            domain,
            title: demoCity === "Honolulu" ? "Iya Terra at The Republik" : `Top show in ${demoCity}`,
            subtitle: `${demoCity} · Jun 14`,
            why: `Next upcoming event in ${demoCity} matched to your taste.`,
            source: "demo",
            asOf: new Date().toISOString(),
            confidence: "high",
          },
        };
        return res.json(demo[domain]);
      }

      // Include city in cache key for city-scoped domains so switching city refreshes the pill.
      const cityScoped = domain === "place" || domain === "event";
      const cacheKey = `${userId}::${domain}${cityScoped && cityParam ? `::${cityParam.toLowerCase()}` : ""}`;
      if (!refresh) {
        const hit = topPickCache.peek(cacheKey);
        if (hit) {
          return res.json(hit);
        }
      }

      // ── Heuristic candidate per domain ────────────────────────────────────
      let candidate: { title: string; subtitle?: string; image?: string; url?: string; signal: string; source: string } | null = null;

      if (domain === "stock") {
        // Prefer Plaid live holdings; fall back to manual.
        const plaidItems = await storage.getPlaidItems(userId).catch(() => [] as any[]);
        const positions: { ticker: string; name?: string; value: number }[] = [];
        for (const item of plaidItems) {
          try {
            const raw: any = await Plaid.getInvestmentHoldings(item.accessToken);
            const secById = new Map<string, any>();
            for (const s of raw.securities || []) secById.set(s.security_id, s);
            for (const h of raw.holdings || []) {
              const sec = secById.get(h.security_id) || {};
              if (!sec.ticker_symbol) continue;
              positions.push({
                ticker: sec.ticker_symbol,
                name: sec.name,
                value: h.institution_value || 0,
              });
            }
          } catch { /* skip broken item */ }
        }
        if (!positions.length) {
          const manual = await storage.listHoldings(userId).catch(() => [] as any[]);
          for (const h of manual) {
            positions.push({
              ticker: (h.ticker || "").toUpperCase(),
              name: h.name || undefined,
              value: (h.shares || 0) * (h.costBasis || 0),
            });
          }
        }
        if (positions.length) {
          // Aggregate by ticker (Plaid sometimes splits across accounts).
          const byTicker = new Map<string, { ticker: string; name?: string; value: number }>();
          for (const p of positions) {
            const prev = byTicker.get(p.ticker);
            if (prev) prev.value += p.value;
            else byTicker.set(p.ticker, { ...p });
          }
          const top = [...byTicker.values()].sort((a, b) => b.value - a.value)[0];
          if (top && top.ticker) {
            candidate = {
              title: top.ticker,
              subtitle: top.name,
              url: `https://finance.yahoo.com/quote/${encodeURIComponent(top.ticker)}`,
              signal: `your largest weighted holding by market value`,
              source: "holdings",
            };
          }
        }
      }

      if (domain === "artist") {
        const st = await Spotify.userStatus(userId).catch(() => ({ authorized: false }));
        if (st.authorized) {
          const top: any = await Spotify.getTopTracks(userId, "short_term", 50).catch(() => ({ tracks: [] as any[] }));
          // Count artist occurrences across recent top tracks; tiebreak by track count.
          const counts = new Map<string, { name: string; count: number; id?: string; image?: string; url?: string }>();
          for (const t of top.tracks || []) {
            const a = t.artist || (Array.isArray(t.artists) && t.artists[0]?.name) || "";
            if (!a) continue;
            const key = a.toLowerCase();
            const prev = counts.get(key);
            if (prev) prev.count++;
            else counts.set(key, { name: a, count: 1, image: t.image, url: t.artistUrl || t.url });
          }
          const top1 = [...counts.values()].sort((a, b) => b.count - a.count)[0];
          if (top1) {
            candidate = {
              title: top1.name,
              subtitle: `${top1.count} track${top1.count > 1 ? "s" : ""} in your short-term top`,
              image: top1.image,
              url: top1.url,
              signal: `most-played artist across your short-term top tracks`,
              source: "spotify",
            };
          }
        }
      }

      if (domain === "movie" || domain === "show") {
        // TOP movie/show MUST be a genuine discovery — never something already on the user's list.
        // We build an exclusion set from BOTH ratings (any signal: liked, disliked, watchlisted) AND
        // user_items (manually added titles). We match on both external ID and normalized title so a
        // manually-added entry with no TMDB id still gets filtered out.
        const tmdbKey = process.env.TMDB_API_KEY;
        if (tmdbKey) {
          const kind = domain === "movie" ? "film" : "show";
          const path = domain === "movie" ? "trending/movie/week" : "trending/tv/week";

          const norm = (s: string) =>
            (s || "")
              .toLowerCase()
              .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
              .replace(/[^a-z0-9 ]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();

          const [ratings, userItems] = await Promise.all([
            storage.listRatings(userId, kind).catch(() => [] as any[]),
            storage.listUserItems(userId, kind).catch(() => [] as any[]),
          ]);
          const seenIds = new Set<string>();
          const seenTitles = new Set<string>();
          for (const r of ratings) {
            if (r.externalId) seenIds.add(String(r.externalId));
            if (r.title) seenTitles.add(norm(r.title));
          }
          // user_items has no external_id — title-only match.
          for (const u of userItems) {
            if (u.title) seenTitles.add(norm(u.title));
          }

          try {
            const r = await fetch(`https://api.themoviedb.org/3/${path}?api_key=${tmdbKey}`);
            if (r.ok) {
              const j: any = await r.json();
              const items: any[] = Array.isArray(j.results) ? j.results : [];
              const fresh = items.find((it) => {
                const idMatch = seenIds.has(String(it.id));
                const titleMatch = seenTitles.has(norm(it.title || it.name || ""));
                return !idMatch && !titleMatch;
              });
              if (fresh) {
                const title = fresh.title || fresh.name;
                const date = (fresh.release_date || fresh.first_air_date || "").slice(0, 4);
                candidate = {
                  title,
                  subtitle: [fresh.vote_average ? `★ ${fresh.vote_average.toFixed(1)}` : null, date].filter(Boolean).join(" · "),
                  image: fresh.poster_path ? `https://image.tmdb.org/t/p/w200${fresh.poster_path}` : undefined,
                  url: `https://www.themoviedb.org/${domain === "movie" ? "movie" : "tv"}/${fresh.id}`,
                  signal: `top trending this week in ${domain === "movie" ? "film" : "TV"}, not yet on your list`,
                  source: "tmdb",
                };
              }
            }
          } catch { /* ignore */ }
        }
      }

      if (domain === "place") {
        // Place pill is city-referential. Priority:
        //   1. Saved place actually IN the selected city (food spot)
        //   2. Atlas path matching the city
        //   3. Any Atlas path (next-scheduled, then first)
        //   4. Any saved food spot
        const cityLc = cityParam.toLowerCase();
        const spots = await storage.listFoodSpots(userId).catch(() => [] as any[]);
        const link = await storage.getAtlasLink(userId).catch(() => null);
        let atlasPaths: any[] = [];
        if (link) {
          try {
            const result = await fetchAtlasPathsForUser(link.atlasUserId, { force: false });
            atlasPaths = result.paths || [];
          } catch { /* ignore */ }
        }

        // Step 1: saved food spot in the selected city.
        if (cityLc) {
          const inCity = spots.find((s: any) => (s.city || "").toLowerCase().includes(cityLc));
          if (inCity) {
            candidate = {
              title: inCity.name,
              subtitle: inCity.city || inCity.cuisine,
              url: inCity.url || undefined,
              signal: `your saved place in ${cityParam}`,
              source: "food-spots",
            };
          }
        }

        // Step 2: Atlas path that mentions the selected city.
        if (!candidate && cityLc && atlasPaths.length) {
          const inCity = atlasPaths.find((p: any) => {
            const blob = `${p.title || ""} ${p.name || ""} ${p.location || ""} ${p.city || ""}`.toLowerCase();
            return blob.includes(cityLc);
          });
          if (inCity) {
            candidate = {
              title: inCity.title || inCity.name || "Untitled path",
              subtitle: inCity.location || inCity.city || undefined,
              url: atlasShareUrl(inCity.id),
              signal: `your Atlas stop in ${cityParam}`,
              source: "atlas",
            };
          }
        }

        // Step 3: any Atlas path (next-scheduled first).
        if (!candidate && atlasPaths.length) {
          const future = atlasPaths.find((p: any) => p.scheduledFor && new Date(p.scheduledFor) > new Date());
          const pick = future || atlasPaths[0];
          candidate = {
            title: pick.title || pick.name || "Untitled path",
            subtitle: pick.location || pick.city || undefined,
            url: atlasShareUrl(pick.id),
            signal: future ? `next scheduled stop on your Atlas` : `top of your Atlas paths`,
            source: "atlas",
          };
        }

        // Step 4: any saved food spot.
        if (!candidate && spots.length) {
          const pick = spots[0];
          candidate = {
            title: pick.name,
            subtitle: pick.city || pick.cuisine,
            url: pick.url || undefined,
            signal: `top of your saved places`,
            source: "food-spots",
          };
        }
      }

      if (domain === "event") {
        if (TM_KEY) {
          // Event pill is city-referential. Use the explicitly selected city first;
          // fall back to food-spots city; finally Honolulu.
          const spots = await storage.listFoodSpots(userId).catch(() => [] as any[]);
          const city = cityParam || (spots[0]?.city as string) || "Honolulu";
          try {
            const tmUrl = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_KEY}&city=${encodeURIComponent(city)}&size=10&sort=date,asc`;
            const r = await fetch(tmUrl);
            if (r.ok) {
              const j: any = await r.json();
              const events = j?._embedded?.events || [];
              const next = events[0];
              if (next) {
                const venue = next._embedded?.venues?.[0]?.name;
                const date = next.dates?.start?.localDate;
                candidate = {
                  title: next.name,
                  subtitle: [venue, date].filter(Boolean).join(" · "),
                  image: next.images?.[0]?.url,
                  url: next.url,
                  signal: `next upcoming event in ${city}`,
                  source: "ticketmaster",
                };
              }
            }
          } catch { /* ignore */ }
        }
      }

      // ── Editorial fallback ─────────────────────────────────────────────
      // If the user has no data in this domain (or a live API is missing),
      // surface a curated default so the pill never goes dark. These are
      // intentionally generic but high-quality — they tell the user what
      // *kind* of recommendation lives here.
      if (!candidate) {
        candidate = editorialFallback(domain, cityParam);
      }

      if (!candidate) {
        const empty = { domain, source: "empty", reason: "no-candidate-data" };
        topPickCache.set(cacheKey, empty);
        return res.json(empty);
      }

      // ── Generate (or fall back to) one-liner ─────────────────────────────
      const why = await claudeOneLiner(domain, {
        title: candidate.title,
        subtitle: candidate.subtitle,
        signal: candidate.signal,
      });

      const confidence: "high" | "low" = LOW_CONFIDENCE_SOURCES.has(candidate.source) ? "low" : "high";
      const showLowConfidence = req.query.showLowConfidence === "1";
      if (confidence === "low" && !showLowConfidence) {
        // Honest default: don't fall back to canned copy. The pill renders
        // nothing and the section below it still tells the user how to seed
        // their data — we just stop pretending we have a pick.
        const empty = { domain, source: "empty", reason: "low-confidence" };
        topPickCache.set(cacheKey, empty);
        return res.json(empty);
      }

      const payload: TopPick = {
        domain,
        title: candidate.title,
        subtitle: candidate.subtitle,
        image: candidate.image,
        url: candidate.url,
        why,
        source: candidate.source,
        confidence,
        asOf: new Date().toISOString(),
      };

      topPickCache.set(cacheKey, payload);
      res.json(payload);
    } catch (e: any) {
      console.error("top-picks error:", e?.message);
      res.status(500).json({ message: e?.message || "unknown" });
    }
  });

  // ============ Ask Lumen — AI assistant w/ full server-side context ============
  app.post("/api/ask-lumen", optionalAuth, async (req, res) => {
    try {
      const { prompt, page } = req.body as { prompt?: string; page?: string };
      if (!prompt || typeof prompt !== "string" || prompt.length > 2000) {
        return res.status(400).json({ message: "Prompt required (≤2000 chars)" });
      }

      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const perplexityKey = process.env.PERPLEXITY_API_KEY;
      const userId = req.user?.id;

      // ── Gather everything Lumen could reference, in parallel ──────────────
      const ctxBits: string[] = [];
      if (page) ctxBits.push(`Current page: ${page}`);
      ctxBits.push(`Today: ${new Date().toISOString().slice(0, 10)}`);

      if (userId) {
        const [holdings, watchlist, subs, places, userItems, plaidItems] = await Promise.all([
          storage.listHoldings(userId).catch(() => [] as any[]),
          storage.listWatchlist(userId).catch(() => [] as any[]),
          storage.listSubscriptions(userId).catch(() => [] as any[]),
          storage.listFoodSpots(userId).catch(() => [] as any[]),
          storage.listUserItems(userId).catch(() => [] as any[]),
          storage.getPlaidItems(userId).catch(() => [] as any[]),
        ]);

        // PORTFOLIO: pull live Plaid holdings if any items connected, else manual.
        let allHoldings: any[] = [];
        let plaidTotal = 0;
        if (plaidItems.length) {
          for (const item of plaidItems) {
            try {
              const raw: any = await Plaid.getInvestmentHoldings(item.accessToken);
              const secById = new Map<string, any>();
              for (const s of raw.securities || []) secById.set(s.security_id, s);
              for (const h of raw.holdings || []) {
                const sec = secById.get(h.security_id) || {};
                allHoldings.push({
                  ticker: sec.ticker_symbol || sec.proxy_security_id || "—",
                  name: sec.name,
                  value: h.institution_value,
                  qty: h.quantity,
                  inst: item.institutionName,
                });
                plaidTotal += h.institution_value || 0;
              }
            } catch { /* skip broken item */ }
          }
        }
        const manualHoldings = (holdings || []).map((h: any) => ({
          ticker: h.symbol, name: h.name, value: (h.shares || 0) * (h.lastPrice || h.costBasis || 0),
        }));
        allHoldings = [...allHoldings, ...manualHoldings];

        if (allHoldings.length) {
          const top = allHoldings
            .sort((a, b) => (b.value || 0) - (a.value || 0))
            .slice(0, 15)
            .map((h) => `${h.ticker}: $${Math.round(h.value || 0).toLocaleString()}${h.inst ? ` @ ${h.inst}` : ""}`);
          const total = allHoldings.reduce((s, h) => s + (h.value || 0), 0);
          ctxBits.push(`Portfolio total: $${Math.round(total).toLocaleString()} across ${allHoldings.length} positions`);
          ctxBits.push(`Top positions: ${top.join("; ")}`);
        }

        if (watchlist.length) {
          ctxBits.push(`Watchlist (${watchlist.length}): ${watchlist.slice(0, 20).map((w: any) => w.symbol).join(", ")}`);
        }

        if (subs.length) {
          const monthly = subs.reduce((s: number, x: any) => {
            if (x.cadence === "monthly") return s + (x.amount || 0);
            if (x.cadence === "yearly") return s + (x.amount || 0) / 12;
            if (x.cadence === "weekly") return s + (x.amount || 0) * 4.33;
            return s;
          }, 0);
          const list = subs.slice(0, 10).map((s: any) => `${s.name} $${s.amount}/${s.cadence}`).join(", ");
          ctxBits.push(`Subscriptions (${subs.length}, ~$${monthly.toFixed(0)}/mo): ${list}`);
        }

        if (places.length) {
          const list = places.slice(0, 10).map((p: any) =>
            `${p.name}${p.city ? ` (${p.city})` : ""}${p.rating ? ` ${p.rating}\u2605` : ""}`
          );
          ctxBits.push(`Saved places (${places.length}): ${list.join(", ")}`);
        }

        if (userItems.length) {
          const byKind = new Map<string, any[]>();
          for (const it of userItems) {
            const k = it.kind || "other";
            if (!byKind.has(k)) byKind.set(k, []);
            byKind.get(k)!.push(it);
          }
          for (const [kind, items] of byKind) {
            ctxBits.push(`${kind} (${items.length}): ${items.slice(0, 8).map((i: any) => i.title || i.name).join(", ")}`);
          }
        }
      }

      // RECENT MUSIC: only if user has Spotify connected, pull last 20 plays.
      if (userId) {
        try {
          const recent: any = await Spotify.getRecentlyPlayed(userId, 20).catch(() => null);
          if (recent?.tracks?.length) {
            const tracks = recent.tracks.slice(0, 10).map((t: any) => `${t.name} — ${t.artist}`);
            ctxBits.push(`Recent listens: ${tracks.join("; ")}`);
          }
        } catch { /* spotify not connected, skip */ }
      }

      const ctxStr = ctxBits.length ? `\n\nUser context (use this to give grounded answers):\n${ctxBits.join("\n")}` : "";

      const system =
        "You are Lumen, a concise personal life-OS assistant. The user is a developer named Jay in Hawaii who tracks finance, music, and places of interest. Give direct, specific answers in 1-3 short paragraphs. No filler. No disclaimers. Use plain text \u2014 no markdown headers, no bullet asterisks, just clean prose. Cite specific tickers/numbers from context when relevant.";
      const userMsg = prompt + ctxStr;

      // Prefer Anthropic Claude if available, else Perplexity, else friendly stub
      if (anthropicKey) {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 600,
            system,
            messages: [{ role: "user", content: userMsg }],
          }),
        });
        if (!r.ok) {
          const t = await r.text();
          return res.status(500).json({ message: `Claude API: ${t.slice(0, 200)}` });
        }
        const j: any = await r.json();
        const answer = j.content?.[0]?.text || "(no response)";
        return res.json({ answer, model: "claude-sonnet-4.6" });
      }

      if (perplexityKey) {
        const r = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${perplexityKey}` },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMsg },
            ],
            max_tokens: 600,
          }),
        });
        if (!r.ok) {
          const t = await r.text();
          return res.status(500).json({ message: `Perplexity API: ${t.slice(0, 200)}` });
        }
        const j: any = await r.json();
        const answer = j.choices?.[0]?.message?.content || "(no response)";
        return res.json({ answer, model: "sonar" });
      }

      return res.json({
        answer:
          "Lumen needs an API key to think. Add ANTHROPIC_API_KEY (preferred) or PERPLEXITY_API_KEY to your Railway env vars and redeploy.",
        model: "stub",
      });
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
