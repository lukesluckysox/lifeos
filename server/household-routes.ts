import type { Express } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import * as Plaid from "./plaid";
import * as Spotify from "./spotify";
import {
  getHouseholdView,
  createOrReuseInvite,
  joinHouseholdByCode,
  previewInvite,
  leaveHousehold,
} from "./household";

// NOTE — integration:
// fetchStockPrices / fetchCryptoPrices are the same helpers /api/portfolio
// already uses to price manual holdings in server/routes.ts. They need an
// `export` keyword added in front of their function declarations there so
// this file can import them. If your actual signatures differ from what's
// assumed below (returns a map of symbol -> { price, dayChangePct, name }),
// adjust the manual-holdings block in /api/household/net-worth accordingly.
import { fetchStockPrices, fetchCryptoPrices } from "./routes";

// Domains that support the opt-out "individual" sharing toggle under the
// household-level "parent" Shared switch. Finance is deliberately NOT in
// this list — it uses the separate opt-in account_visibility model above
// because the stakes of an accidental balance leak are higher.
const SHARABLE_DOMAINS = ["music", "events"] as const;
type SharableDomain = (typeof SHARABLE_DOMAINS)[number];

// Local copy of routes.ts's tmFetch — small enough to duplicate rather
// than add another cross-file export dependency. Keep in sync if the
// Ticketmaster query shape changes there.
async function tmFetch(params: Record<string, string>) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ apikey: key, ...params }).toString();
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${qs}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Household — shared-view infrastructure for couples.
 *
 * Call this once from server/routes.ts's registerRoutes(), e.g.:
 *
 *   import { registerHouseholdRoutes } from "./household-routes";
 *   ...
 *   export async function registerRoutes(httpServer: Server, app: Express) {
 *     ...
 *     registerHouseholdRoutes(app);
 *     ...
 *   }
 */
export function registerHouseholdRoutes(app: Express) {
  // ── Household lookup ────────────────────────────────────────────────────
  app.get("/api/household", requireAuth, async (req, res) => {
    try {
      const household = await getHouseholdView(req.user!.id);
      res.json({ household });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Invite flow ──────────────────────────────────────────────────────────
  // Creates a household for the caller if they don't have one, and
  // returns a shareable link — the same shape as the Atlas connect flow,
  // but self-contained (no external OAuth round trip needed).
  app.post("/api/household/invite", requireAuth, async (req, res) => {
    try {
      const publicUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
      const invite = await createOrReuseInvite(req.user!.id, publicUrl);
      res.json(invite);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Preview an invite before accepting it — powers the "X wants to share
  // Life OS with you" confirm screen on the /join-household/:code page.
  app.get("/api/household/invite/:code", requireAuth, async (req, res) => {
    try {
      const preview = await previewInvite(req.params.code);
      res.json(preview);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Accept an invite. Intentionally a POST (not the GET the link itself
  // uses) so simply opening the link never silently joins a household —
  // the client shows a confirm button first.
  app.post("/api/household/join", requireAuth, async (req, res) => {
    try {
      const code = String(req.body?.code || "").trim();
      if (!code) return res.status(400).json({ ok: false, error: "Missing invite code." });
      const result = await joinHouseholdByCode(req.user!.id, code);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Leave the current household. Data isn't deleted — you just stop
  // contributing to / seeing the shared view.
  app.post("/api/household/leave", requireAuth, async (req, res) => {
    try {
      const r = await leaveHousehold(req.user!.id);
      res.json({ ok: true, changes: r.changes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Per-account visibility (Finance only) ───────────────────────────────
  // account_type: "plaid_item" | "manual". account_ref: the Plaid
  // item_id, or the literal "manual" for the hand-entered holdings
  // bucket. Absent row = not visible — sharing is opt-in.
  app.get("/api/household/visibility", requireAuth, async (req, res) => {
    try {
      const household = await storage.getHouseholdForUser(req.user!.id);
      if (!household) return res.json({ household: null, settings: [] });
      const settings = await storage.getAccountVisibility(household.id, req.user!.id);
      res.json({ household: { id: household.id }, settings });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/household/visibility", requireAuth, async (req, res) => {
    try {
      const { accountType, accountRef, visible } = req.body || {};
      if (!accountType || !accountRef) {
        return res.status(400).json({ message: "accountType and accountRef are required." });
      }
      const household = await storage.getHouseholdForUser(req.user!.id);
      if (!household) return res.status(400).json({ message: "You're not in a household yet." });
      await storage.setAccountVisibility(household.id, req.user!.id, accountType, accountRef, !!visible);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Shared net worth ─────────────────────────────────────────────────────
  // Combines Plaid + manual holdings across every household member,
  // honoring each member's account_visibility settings.
  //
  // Key design point (per product decision): the requesting user always
  // sees 100% of their OWN accounts — visibility only gates what a
  // PARTNER can see. An account marked hidden is excluded from the
  // shared total entirely, not folded in anonymously, so this number is
  // identical no matter which household member is looking at it.
  app.get("/api/household/net-worth", requireAuth, async (req, res) => {
    try {
      const household = await storage.getHouseholdForUser(req.user!.id);
      if (!household) return res.json({ inHousehold: false });

      const memberIds = await storage.getHouseholdMemberIds(household.id);

      let combinedValue = 0;
      const perMember: Array<{
        userId: number;
        displayName: string | null;
        value: number;
        accountsIncluded: number;
        accountsHidden: number;
      }> = [];

      for (const memberId of memberIds) {
        const isSelf = memberId === req.user!.id;
        const user = await storage.getUser(memberId);
        const visibility = await storage.getAccountVisibility(household.id, memberId);
        const visibleSet = new Set(visibility.filter(v => v.visible).map(v => `${v.accountType}:${v.accountRef}`));

        let memberValue = 0;
        let included = 0;
        let hidden = 0;

        // Plaid-connected accounts — institution_value from Plaid is
        // already a total, no separate price lookup needed.
        const plaidItems = await storage.getPlaidItems(memberId);
        for (const item of plaidItems) {
          const key = `plaid_item:${item.itemId}`;
          const ok = isSelf || visibleSet.has(key);
          if (!ok) { hidden++; continue; }
          included++;
          try {
            const data = await Plaid.getInvestmentHoldings(item.accessToken);
            for (const h of (data.holdings || []) as any[]) {
              const sec = ((data.securities || []) as any[]).find((s: any) => s.security_id === h.security_id);
              const price = Number(h.institution_price ?? sec?.close_price ?? 0) || 0;
              const qty = Number(h.quantity) || 0;
              memberValue += Number(h.institution_value ?? qty * price) || 0;
            }
          } catch {
            // Institution unreachable — skip rather than fail the whole card.
          }
        }

        // Manually-entered holdings bucket — needs a live price lookup,
        // same as /api/portfolio does for the "me" view.
        const manualKey = "manual:manual";
        const manualOk = isSelf || visibleSet.has(manualKey);
        const manual = await storage.listHoldings(memberId);
        if (manual.length) {
          if (manualOk) {
            included++;
            const stockSymbols = manual.filter((h: any) => h.kind === "stock").map((h: any) => h.symbol);
            const cryptoSymbols = manual.filter((h: any) => h.kind === "crypto").map((h: any) => h.symbol);
            const [stockPrices, cryptoPrices] = await Promise.all([
              stockSymbols.length ? fetchStockPrices(stockSymbols) : Promise.resolve({} as Record<string, any>),
              cryptoSymbols.length ? fetchCryptoPrices(cryptoSymbols) : Promise.resolve({} as Record<string, any>),
            ]);
            for (const h of manual as any[]) {
              const px = h.kind === "stock" ? (stockPrices as any)[h.symbol] : (cryptoPrices as any)[h.symbol.toUpperCase()];
              const price = px?.price ?? h.costBasis;
              memberValue += h.quantity * price;
            }
          } else {
            hidden++;
          }
        }

        // Cash / savings accounts — no price lookup, just the balance the
        // owner entered. Excluded from the portfolio entirely (owner's
        // own "include in portfolio" choice) takes priority over sharing;
        // an account left out of your own total never counts toward the
        // household's either.
        const cashAccounts = await storage.listCashAccounts(memberId);
        for (const acc of cashAccounts as any[]) {
          if (!acc.includeInPortfolio) continue;
          const key = `cash_account:${acc.id}`;
          const ok = isSelf || visibleSet.has(key);
          if (!ok) { hidden++; continue; }
          included++;
          memberValue += Number(acc.balance) || 0;
        }

        combinedValue += memberValue;
        perMember.push({
          userId: memberId,
          displayName: user?.displayName ?? null,
          value: memberValue,
          accountsIncluded: included,
          accountsHidden: hidden,
        });
      }

      res.json({
        inHousehold: true,
        totalValue: combinedValue,
        perMember,
        asOf: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Domain-level sharing settings (Music, Events) ───────────────────────
  // Opt-out: a domain is shared unless the owning member explicitly turns
  // it off. This is the "individual" layer under the household's "parent"
  // Shared toggle — join the household once, then dial any one domain
  // back down without leaving.
  app.get("/api/household/domain-shares", requireAuth, async (req, res) => {
    try {
      const household = await storage.getHouseholdForUser(req.user!.id);
      if (!household) return res.json({ household: null, settings: {} });
      const raw = await storage.getDomainShareSettings(household.id, req.user!.id);
      const settings: Record<SharableDomain, boolean> = {} as any;
      for (const d of SHARABLE_DOMAINS) settings[d] = raw[d] ?? true;
      res.json({ household: { id: household.id }, settings });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/household/domain-shares", requireAuth, async (req, res) => {
    try {
      const { domain, shared } = req.body || {};
      if (!SHARABLE_DOMAINS.includes(domain)) {
        return res.status(400).json({ message: `domain must be one of: ${SHARABLE_DOMAINS.join(", ")}` });
      }
      const household = await storage.getHouseholdForUser(req.user!.id);
      if (!household) return res.status(400).json({ message: "You're not in a household yet." });
      await storage.setDomainShared(household.id, req.user!.id, domain, !!shared);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Shared Music ─────────────────────────────────────────────────────────
  // Merges each opted-in household member's own live Spotify pull (each
  // person authorizes their own Spotify account — there's no such thing
  // as a "combined" Spotify query) plus their pinned tracks
  // (user_items, kind="music"). The requester's own listening always
  // shows regardless of their own toggle; a partner's shows only if
  // they haven't turned Music sharing off.
  app.get("/api/household/music", requireAuth, async (req, res) => {
    try {
      const household = await storage.getHouseholdForUser(req.user!.id);
      if (!household) return res.json({ inHousehold: false, tracks: [] });

      const section = (req.query.section as string | undefined) === "top" ? "top" : "recent";
      const memberIds = await storage.getHouseholdMemberIds(household.id);

      const combined: any[] = [];
      for (const memberId of memberIds) {
        const isSelf = memberId === req.user!.id;
        if (!isSelf) {
          const shares = await storage.getDomainShareSettings(household.id, memberId);
          if (!(shares.music ?? true)) continue;
        }
        const user = await storage.getUser(memberId);
        const sharedBy = isSelf ? null : user?.displayName ?? null;

        const st = await Spotify.userStatus(memberId).catch(() => ({ authorized: false } as any));
        if (st.authorized) {
          try {
            const snap: any = section === "top"
              ? await Spotify.getTopTracks(memberId, "short_term", 15)
              : await Spotify.getRecentlyPlayed(memberId, 15);
            for (const t of snap?.tracks || []) {
              combined.push({ ...t, sharedBy, sharedByUserId: memberId });
            }
          } catch {}
        }

        try {
          const pinned = await storage.listUserItems(memberId, "music");
          for (const p of pinned as any[]) {
            combined.push({
              id: `user-${p.id}`,
              name: p.title,
              artist: p.subtitle || "",
              url: p.url || undefined,
              pinned: true,
              playedAt: new Date(p.createdAt).toISOString(),
              sharedBy,
              sharedByUserId: memberId,
            });
          }
        } catch {}
      }

      combined.sort((a, b) => {
        if (section === "top") return (b.popularity ?? 0) - (a.popularity ?? 0);
        return new Date(b.playedAt || 0).getTime() - new Date(a.playedAt || 0).getTime();
      });

      res.json({ inHousehold: true, source: "household", section, tracks: combined.slice(0, 40) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Shared Events ────────────────────────────────────────────────────────
  // Mirrors /api/concerts-for-you's artist-matching logic, but builds the
  // artist list from every opted-in household member's Spotify + pinned
  // artists before querying Ticketmaster, so a show either partner would
  // like surfaces once instead of requiring each person to check alone.
  app.get("/api/household/concerts-for-you", requireAuth, async (req, res) => {
    try {
      const household = await storage.getHouseholdForUser(req.user!.id);
      if (!household) return res.json({ inHousehold: false, city: "", concerts: [] });

      const city = (req.query.city as string | undefined)?.trim() || "Honolulu";
      const memberIds = await storage.getHouseholdMemberIds(household.id);

      const seen = new Set<string>();
      const artists: string[] = [];
      const artistOwners = new Map<string, string[]>();
      const pushArtist = (name: string, ownerName: string | null) => {
        const primary = (name || "").split(",")[0].trim();
        if (!primary) return;
        const key = primary.toLowerCase();
        if (!seen.has(key)) { seen.add(key); artists.push(primary); }
        if (ownerName) {
          const list = artistOwners.get(key) ?? [];
          if (!list.includes(ownerName)) list.push(ownerName);
          artistOwners.set(key, list);
        }
      };

      for (const memberId of memberIds) {
        const isSelf = memberId === req.user!.id;
        if (!isSelf) {
          const shares = await storage.getDomainShareSettings(household.id, memberId);
          if (!(shares.events ?? true)) continue;
        }
        const user = await storage.getUser(memberId);
        const ownerName = isSelf ? null : user?.displayName ?? null;

        const st = await Spotify.userStatus(memberId).catch(() => ({ authorized: false } as any));
        if (st.authorized) {
          try {
            const [followed, recent, top] = await Promise.all([
              Spotify.getFollowedArtists(memberId, 20).catch(() => [] as any[]),
              Spotify.getRecentlyPlayed(memberId, 20).catch(() => ({ tracks: [] as any[] })),
              Spotify.getTopTracks(memberId, "short_term", 20).catch(() => ({ tracks: [] as any[] })),
            ]);
            for (const a of followed as any[]) pushArtist(a.name, ownerName);
            for (const t of (recent as any).tracks || []) pushArtist(t.artist, ownerName);
            for (const t of (top as any).tracks || []) pushArtist(t.artist, ownerName);
          } catch {}
        }

        try {
          const pinnedArtists = await storage.listUserItems(memberId, "artist");
          for (const p of pinnedArtists as any[]) pushArtist(p.title, ownerName);
        } catch {}
      }

      if (artists.length === 0) {
        return res.json({ inHousehold: true, source: "none", city, concerts: [] });
      }
      if (!process.env.TICKETMASTER_API_KEY) {
        return res.json({ inHousehold: true, source: "unconfigured", city, concerts: [] });
      }

      const concerts: any[] = [];
      for (const a of artists.slice(0, 10)) {
        try {
          const data = await tmFetch({ size: "3", keyword: a, city, sort: "date,asc" });
          const events: any[] = data?._embedded?.events ?? [];
          const owners = artistOwners.get(a.toLowerCase()) ?? [];
          for (const e of events) {
            concerts.push({
              artist: a,
              name: e.name,
              venue: e._embedded?.venues?.[0]?.name || "",
              city: e._embedded?.venues?.[0]?.city?.name || city,
              date: e.dates?.start?.localDate || "",
              url: e.url,
              basedOn: owners.length ? `${a} — also in ${owners.join(" & ")}'s rotation` : a,
            });
            if (concerts.length >= 15) break;
          }
        } catch {}
        if (concerts.length >= 15) break;
      }

      const seenConcerts = new Set<string>();
      const deduped = concerts.filter((c: any) => {
        const k = (c.url || `${c.name || ""}|${c.date || ""}|${c.venue || ""}`).toLowerCase();
        if (seenConcerts.has(k)) return false;
        seenConcerts.add(k);
        return true;
      });

      res.json({ inHousehold: true, source: "ticketmaster", city, concerts: deduped });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
