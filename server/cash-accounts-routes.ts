import type { Express } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";

/**
 * Manual cash / savings accounts — for balances that don't have tickers
 * and won't connect via Plaid (a local credit union savings account, a
 * brokerage that refuses to link, cash you're just tracking by hand).
 * No price feed, no day-change, no cost basis — just a name and a
 * balance you update yourself, with a switch for whether it counts
 * toward the overall portfolio total.
 *
 * Call this once from server/routes.ts's registerRoutes(), same as
 * registerHouseholdRoutes:
 *
 *   import { registerCashAccountRoutes } from "./cash-accounts-routes";
 *   ...
 *   registerCashAccountRoutes(app);
 */
export function registerCashAccountRoutes(app: Express) {
  app.get("/api/cash-accounts", requireAuth, async (req, res) => {
    try {
      const accounts = await storage.listCashAccounts(req.user!.id);
      res.json(accounts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Convenience endpoint — the sum of every account with
  // includeInPortfolio=true. Fold this into wherever net worth is
  // computed client-side (see INTEGRATION.md for the exact spot in
  // Home.tsx and Finance.tsx).
  app.get("/api/cash-accounts/total", requireAuth, async (req, res) => {
    try {
      const accounts = await storage.listCashAccounts(req.user!.id);
      const total = accounts
        .filter((a: any) => a.includeInPortfolio)
        .reduce((sum: number, a: any) => sum + Number(a.balance || 0), 0);
      res.json({ total, accountCount: accounts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/cash-accounts", requireAuth, async (req, res) => {
    try {
      const { name, institution, balance, includeInPortfolio, notes } = req.body || {};
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "name is required." });
      }
      const bal = Number(balance);
      if (!Number.isFinite(bal)) {
        return res.status(400).json({ message: "balance must be a number." });
      }
      const account = await storage.addCashAccount(req.user!.id, {
        name: name.trim(),
        institution: institution ? String(institution).trim() : undefined,
        balance: bal,
        includeInPortfolio: includeInPortfolio !== false,
        notes: notes ? String(notes).trim() : undefined,
      });
      res.json(account);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/cash-accounts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const patch: any = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) return res.status(400).json({ message: "name can't be empty." });
        patch.name = name;
      }
      if (req.body?.institution !== undefined) patch.institution = String(req.body.institution).trim() || null;
      if (req.body?.balance !== undefined) {
        const bal = Number(req.body.balance);
        if (!Number.isFinite(bal)) return res.status(400).json({ message: "balance must be a number." });
        patch.balance = bal;
      }
      if (req.body?.includeInPortfolio !== undefined) patch.includeInPortfolio = !!req.body.includeInPortfolio;
      if (req.body?.notes !== undefined) patch.notes = String(req.body.notes).trim() || null;

      const account = await storage.updateCashAccount(req.user!.id, id, patch);
      if (!account) return res.status(404).json({ message: "Cash account not found." });
      res.json(account);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/cash-accounts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await storage.removeCashAccount(req.user!.id, id);
      res.json({ ok: true, changes: r.changes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
