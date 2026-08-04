import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Plus, X, Wallet, Eye, EyeOff, Trash2 } from "lucide-react";

interface CashAccount {
  id: number;
  name: string;
  institution: string | null;
  balance: number;
  includeInPortfolio: boolean;
  notes: string | null;
  createdAt: number;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * Manual savings / cash accounts — for balances that don't have a
 * ticker and won't connect via Plaid. No price feed: you type in a
 * balance and update it yourself. Each account has its own switch for
 * whether it counts toward the overall portfolio total, so you can log
 * an account here without it double-counting or skewing the net worth
 * number if you'd rather it stayed informational.
 *
 * Drop <CashAccounts /> into Finance.tsx, near the manual holdings /
 * watchlist section. Renders its own card with an "Add savings account"
 * pill that expands into a small inline form — same interaction as the
 * other pill affordances in the header (location, invite, mode toggle).
 */
export function CashAccounts() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [balance, setBalance] = useState("");
  const [includeInPortfolio, setIncludeInPortfolio] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery<CashAccount[]>({
    queryKey: ["/api/cash-accounts"],
    queryFn: async () => (await apiRequest("GET", "/api/cash-accounts")).json(),
  });

  const total = accounts.filter(a => a.includeInPortfolio).reduce((s, a) => s + a.balance, 0);

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
    queryClient.invalidateQueries({ queryKey: ["/api/household/net-worth"] });
    queryClient.invalidateQueries({ queryKey: ["/api/household/visibility"] });
  };

  const save = async () => {
    const trimmedName = name.trim();
    const bal = Number(balance);
    if (!trimmedName) { setError("Give it a name — e.g. \"Ally Savings\"."); return; }
    if (!Number.isFinite(bal)) { setError("Balance needs to be a number."); return; }
    setSaving(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/cash-accounts", {
        name: trimmedName,
        institution: institution.trim() || undefined,
        balance: bal,
        includeInPortfolio,
      });
      invalidateAll();
      resetForm();
    } catch {
      setError("Couldn't save that account — try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleInclude = async (acc: CashAccount) => {
    await apiRequest("PATCH", `/api/cash-accounts/${acc.id}`, { includeInPortfolio: !acc.includeInPortfolio });
    invalidateAll();
  };

  const remove = async (acc: CashAccount) => {
    await apiRequest("DELETE", `/api/cash-accounts/${acc.id}`);
    invalidateAll();
  };

  return (
    <section className="rounded-xl border border-border bg-card/40 p-5" data-testid="section-cash-accounts">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Wallet size={13} className="text-blue" />
          <h2 className="font-display text-base">Savings &amp; cash</h2>
        </div>
        <div className="relative">
          <button
            type="button"
            data-testid="button-add-cash-account"
            onClick={() => setAdding(o => !o)}
            className="h-8 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 hover:bg-accent px-3 transition-colors font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            {adding ? <X size={12} /> : <Plus size={12} />}
            {adding ? "Cancel" : "Add account"}
          </button>

          {adding && (
            <>
              <div className="fixed inset-0 z-30" onClick={resetForm} />
              <div
                className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg z-40 p-3"
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
                  <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1 cursor-pointer">
                    <input
                      data-testid="checkbox-include-in-portfolio"
                      type="checkbox"
                      checked={includeInPortfolio}
                      onChange={e => setIncludeInPortfolio(e.target.checked)}
                      className="h-3.5 w-3.5 accent-blue"
                    />
                    Add to overall portfolio total
                  </label>
                  {error && <div className="text-[11px] text-rose">{error}</div>}
                  <button
                    type="button"
                    data-testid="button-save-cash-account"
                    onClick={save}
                    disabled={saving}
                    className="w-full mt-1 rounded-md bg-blue text-white text-xs font-medium py-1.5 hover:opacity-90 transition disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Add account"}
                  </button>
                </div>
                <div className="mt-3 pt-3 border-t border-border/40 text-[10px] text-muted-foreground italic">
                  No ticker, no price feed — just a balance you update yourself. It's cash, not a position.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          No savings accounts yet. Add one for a bank or brokerage that won't connect through Plaid.
        </p>
      ) : (
        <>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3 mt-2">
            {money(total)} counted toward your portfolio total
          </div>
          <ul className="space-y-1.5">
            {accounts.map(acc => (
              <li
                key={acc.id}
                className="flex items-center justify-between gap-3 text-sm rounded-md border border-border/60 px-3 py-2"
                data-testid={`item-cash-account-${acc.id}`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{acc.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {acc.institution ? `${acc.institution} · ` : ""}
                    <span className="tabular">{money(acc.balance)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid={`button-toggle-include-cash-${acc.id}`}
                    onClick={() => toggleInclude(acc)}
                    title={acc.includeInPortfolio ? "Counted in your portfolio total. Click to exclude." : "Not counted in your portfolio total. Click to include."}
                    className={`inline-flex items-center gap-1 text-[10px] rounded-full border px-2 py-1 transition ${
                      acc.includeInPortfolio ? "border-blue/40 bg-blue/10 text-blue" : "border-border text-muted-foreground"
                    }`}
                  >
                    {acc.includeInPortfolio ? <Eye size={11} /> : <EyeOff size={11} />}
                    {acc.includeInPortfolio ? "In total" : "Excluded"}
                  </button>
                  <button
                    type="button"
                    data-testid={`button-delete-cash-${acc.id}`}
                    onClick={() => remove(acc)}
                    aria-label={`Remove ${acc.name}`}
                    className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-rose hover:bg-rose/10 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
