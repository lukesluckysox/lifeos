import type { Express } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import * as Plaid from "./plaid";
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
}
