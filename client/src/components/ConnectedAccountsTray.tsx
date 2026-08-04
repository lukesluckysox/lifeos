import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useScope } from "./ScopeProvider";
import { Building2, Wallet, Plus, X, Eye, EyeOff, Trash2, Landmark } from "lucide-react";

interface PlaidItemRow { id: number; itemId: string; institutionName: string; createdAt: number }
interface CashAccount {
  id: number;
  name: string;
  institution: string | null;
  balance: number;
  includeInPortfolio: boolean;
  notes: string | null;
  createdAt: number;
}

/** Owner-attributed shapes returned by GET /api/household/accounts —
 * same accounts as the personal queries above, but merged across the
 * household and tagged with whose account each one is, respecting the
 * same opt-in visibility rules /api/household/net-worth already uses
 * (a partner's account only appears if they've marked it shared). */
interface HouseholdPlaidRow { itemId: string; institutionName: string | null; ownerId: number; ownerDisplayName: string | null; isSelf: boolean }
interface HouseholdCashRow { id: number; name: string; institution: string | null; balance: number; ownerId: number; ownerDisplayName: string | null; isSelf: boolean }
interface HouseholdAccountsResp { inHousehold: boolean; plaid: HouseholdPlaidRow[]; cash: HouseholdCashRow[] }

const ownerLabel = (isSelf: boolean, displayName: string | null) =>
  isSelf ? "Me" : (displayName || "Partner");

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const slugifyForTestId = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "brokerage";

/**
 * Turns whatever apiRequest() threw into an actionable message. Same
 * helper pattern as HouseholdScopePill.tsx's describeInviteError and
 * Places.tsx's describePlaceError — duplicated locally per this
 * codebase's existing precedent (household-routes.ts's local tmFetch
 * copy) rather than adding a shared-util cross-file dependency.
 */
function describeCashError(e: any): string {
  const raw = String(e?.message ?? "");
  if (/<!doctype/i.test(raw) || /^\s*</.test(raw) || /unexpected token/i.test(raw)) {
    return "The cash-accounts endpoint isn't returning JSON — registerCashAccountRoutes(app) is likely missing from server/routes.ts (the request is falling through to the app's HTML shell instead of hitting a real handler). See INTEGRATION.md / ROUTES_PATCH.txt.";
  }
  const colonIdx = raw.indexOf(": ");
  const status = colonIdx > -1 ? raw.slice(0, colonIdx) : "";
  const bodyText = colonIdx > -1 ? raw.slice(colonIdx + 2) : raw;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed?.message) return parsed.message;
  } catch {}
  if (status === "404") {
    return "Cash-accounts endpoint not found (404). registerCashAccountRoutes(app) is likely missing from server/routes.ts — see INTEGRATION.md / ROUTES_PATCH.txt.";
  }
  return bodyText || raw || "Couldn't save that account — try again.";
}

/**
 * Replaces the old read-only "Connected brokerages strip" in Finance.tsx.
 * Same row, same chip styling — brokerage chips are unchanged (still
 * read-only, sourced from Plaid), but now a manual savings/cash account
 * can be added right here as its own chip, via a "+" pill at the end of
 * the row. No ticker, no price feed — just a name and a balance you
 * update yourself.
 *
 * Each cash chip has its own eye/eye-off toggle for whether it counts
 * toward the portfolio total (see usePortfolio() in Finance.tsx, which
 * now also queries /api/cash-accounts and folds included balances into
 * netWorth) and an "x" to remove it.
 *
 * Renders even with zero brokerages/cash accounts connected — the "+"
 * pill needs to be reachable from an empty state too.
 */
export function ConnectedAccountsTray({
  plaidItems,
  manualBrokerages = [],
}: {
  plaidItems: PlaidItemRow[];
  /** Distinct brokerage/account labels used across manual (hand-entered)
   * holdings — e.g. "Fidelity", "Robinhood", "Held at home" — with their
   * combined value. Not a live connection, just a grouping label set in
   * the Manual entry form; shown here as its own read-only pill so it's
   * visible in the same "Connected" row as real Plaid/cash accounts. */
  manualBrokerages?: { name: string; value: number }[];
}) {
  const queryClient = useQueryClient();
  const { scope, household } = useScope();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [balance, setBalance] = useState("");
  const [includeInPortfolio, setIncludeInPortfolio] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: cashAccounts = [] } = useQuery<CashAccount[]>({
    queryKey: ["/api/cash-accounts"],
    queryFn: async () => (await apiRequest("GET", "/api/cash-accounts")).json(),
  });

  // Only fetched in Shared view — this is what lets the tray show whose
  // account is whose ("(Me)" / partner's name) instead of just listing
  // your own accounts regardless of scope.
  const { data: householdAccounts } = useQuery<HouseholdAccountsResp>({
    queryKey: ["/api/household/accounts"],
    queryFn: async () => (await apiRequest("GET", "/api/household/accounts")).json(),
    enabled: scope === "shared" && !!household,
  });
  const isShared = scope === "shared" && !!household && !!householdAccounts?.inHousehold;

  // Your own accounts always render from the personal queries (full
  // toggle/delete still works) — only a partner's shared accounts get
  // appended from /api/household/accounts, and those render read-only
  // (you can't toggle or delete something you don't own).
  const partnerPlaid = isShared ? householdAccounts!.plaid.filter(r => !r.isSelf) : [];
  const partnerCash = isShared ? householdAccounts!.cash.filter(r => !r.isSelf) : [];

  const resetForm = () => {
    setName("");
    setInstitution("");
    setBalance("");
    setIncludeInPortfolio(true);
    setError(null);
    setAdding(false);
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cash-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cash-accounts/total"] });
    queryClient.invalidateQueries({ queryKey: ["/api/household/net-worth"] });
    queryClient.invalidateQueries({ queryKey: ["/api/household/visibility"] });
  };

  const save = async () => {
    const trimmedName = name.trim();
    const bal = Number(balance);
    if (!trimmedName) { setError("Give it a name — e.g. \"Ally Savings.\""); return; }
    if (!Number.isFinite(bal)) { setError("Balance needs to be a number."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/cash-accounts", {
        name: trimmedName,
        institution: institution.trim() || undefined,
        balance: bal,
        includeInPortfolio,
      });
      // Same failure mode as the invite link and visited-places bugs:
      // if registerCashAccountRoutes(app) isn't wired into routes.ts,
      // this can come back 200 with the app's HTML shell instead of a
      // real JSON response — the account never actually saves, but a
      // bare catch here would show nothing more useful than "try
      // again." Check content-type so that's diagnosable instead.
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("<!doctype (got an HTML page instead of JSON)");
      }
      invalidateAll();
      resetForm();
    } catch (e: any) {
      setError(describeCashError(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleInclude = async (acc: CashAccount) => {
    try {
      await apiRequest("PATCH", `/api/cash-accounts/${acc.id}`, { includeInPortfolio: !acc.includeInPortfolio });
      invalidateAll();
    } catch (e: any) {
      setError(describeCashError(e));
    }
  };

  const remove = async (acc: CashAccount) => {
    try {
      await apiRequest("DELETE", `/api/cash-accounts/${acc.id}`);
      invalidateAll();
    } catch (e: any) {
      setError(describeCashError(e));
    }
  };

  const hasAnything = plaidItems.length > 0 || cashAccounts.length > 0 || partnerPlaid.length > 0 || partnerCash.length > 0 || manualBrokerages.length > 0;

  return (
    <div
      className="flex items-center gap-2 flex-wrap text-xs font-mono uppercase tracking-wider text-muted-foreground -mb-10"
      data-testid="strip-connected-brokerages"
    >
      <Building2 size={12} className="text-teal" />
      <span className="text-muted-foreground/70">{hasAnything ? "Connected" : "Nothing connected yet"}</span>

      {plaidItems.map(it => (
        <span
          key={`plaid-${it.id}`}
          className="rounded-full border border-teal/30 bg-teal/5 text-foreground/90 px-2 py-0.5 normal-case tracking-normal"
          data-testid={`chip-brokerage-${it.id}`}
        >
          {it.institutionName}
          {isShared && <span className="opacity-60"> (Me)</span>}
        </span>
      ))}

      {partnerPlaid.map(row => (
        <span
          key={`plaid-partner-${row.itemId}`}
          className="rounded-full border border-teal/30 bg-teal/5 text-foreground/90 px-2 py-0.5 normal-case tracking-normal"
          data-testid={`chip-brokerage-partner-${row.itemId}`}
          title="Your partner's connected brokerage — shared from their Settings."
        >
          {row.institutionName}
          <span className="opacity-60"> ({ownerLabel(false, row.ownerDisplayName)})</span>
        </span>
      ))}

      {manualBrokerages.map(b => (
        <span
          key={`manual-brokerage-${b.name}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/5 text-foreground/90 px-2 py-0.5 normal-case tracking-normal"
          data-testid={`chip-manual-brokerage-${slugifyForTestId(b.name)}`}
          title="Manually-tracked holdings grouped under this label — not a live connection."
        >
          <Landmark size={10} className="text-gold" />
          {b.name}
          <span className="tabular opacity-70">{money(b.value)}</span>
        </span>
      ))}

      {cashAccounts.map(acc => (
        <span
          key={`cash-${acc.id}`}
          className={`group inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 normal-case tracking-normal transition-colors ${
            acc.includeInPortfolio ? "border-blue/30 bg-blue/5 text-foreground/90" : "border-border bg-secondary/20 text-muted-foreground"
          }`}
          data-testid={`chip-cash-account-${acc.id}`}
        >
          <Wallet size={10} className={acc.includeInPortfolio ? "text-blue" : "text-muted-foreground/60"} />
          {acc.name}
          {isShared && <span className="opacity-60">(Me)</span>}
          <span className="tabular opacity-70">{money(acc.balance)}</span>
          <button
            type="button"
            data-testid={`button-toggle-include-cash-${acc.id}`}
            onClick={() => toggleInclude(acc)}
            title={acc.includeInPortfolio ? "Counted in your portfolio total. Click to exclude." : "Not counted in your portfolio total. Click to include."}
            className="opacity-50 hover:opacity-100 transition-opacity"
          >
            {acc.includeInPortfolio ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
          <button
            type="button"
            data-testid={`button-delete-cash-${acc.id}`}
            onClick={() => remove(acc)}
            aria-label={`Remove ${acc.name}`}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
          >
            <Trash2 size={10} />
          </button>
        </span>
      ))}

      {partnerCash.map(row => (
        <span
          key={`cash-partner-${row.id}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-blue/30 bg-blue/5 text-foreground/90 px-2 py-0.5 normal-case tracking-normal"
          data-testid={`chip-cash-account-partner-${row.id}`}
          title="Your partner's savings account — shared from their Settings."
        >
          <Wallet size={10} className="text-blue" />
          {row.name}
          <span className="opacity-60">({ownerLabel(false, row.ownerDisplayName)})</span>
          <span className="tabular opacity-70">{money(row.balance)}</span>
        </span>
      ))}

      <div className="relative normal-case tracking-normal">
        <button
          type="button"
          data-testid="button-add-cash-account"
          onClick={() => setAdding(o => !o)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border hover:border-blue/40 hover:text-blue px-2 py-0.5 transition-colors"
        >
          {adding ? <X size={10} /> : <Plus size={10} />}
          Add savings account
        </button>

        {adding && (
          <>
            <div className="fixed inset-0 z-30" onClick={resetForm} />
            <div
              className="absolute left-0 mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg z-40 p-3 normal-case tracking-normal"
              data-testid="menu-add-cash-account"
            >
              <div className="eyebrow mb-2">Add a savings account</div>
              <div className="space-y-2">
                <input
                  data-testid="input-cash-account-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Name — e.g. Ally Savings"
                  className="w-full h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal"
                  autoFocus
                />
                <input
                  data-testid="input-cash-account-institution"
                  value={institution}
                  onChange={e => setInstitution(e.target.value)}
                  placeholder="Institution (optional)"
                  className="w-full h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal"
                />
                <input
                  data-testid="input-cash-account-balance"
                  value={balance}
                  onChange={e => setBalance(e.target.value)}
                  placeholder="Balance — e.g. 12000"
                  inputMode="decimal"
                  className="w-full h-8 text-sm rounded-md border border-border bg-background px-2.5 focus:outline-none focus:ring-1 focus:ring-teal tabular"
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1 cursor-pointer normal-case">
                  <input
                    data-testid="checkbox-include-in-portfolio"
                    type="checkbox"
                    checked={includeInPortfolio}
                    onChange={e => setIncludeInPortfolio(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue"
                  />
                  Add to overall portfolio total
                </label>
                {error && <div className="text-[11px] text-rose normal-case">{error}</div>}
                <button
                  type="button"
                  data-testid="button-save-cash-account"
                  onClick={save}
                  disabled={saving}
                  className="w-full mt-1 rounded-md bg-blue text-white text-xs font-medium py-1.5 hover:opacity-90 transition disabled:opacity-60 normal-case"
                >
                  {saving ? "Saving…" : "Add account"}
                </button>
              </div>
              <div className="mt-3 pt-3 border-t border-border/40 text-[10px] text-muted-foreground italic normal-case">
                No ticker, no price feed — just a balance you update yourself. It's cash, not a position.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
