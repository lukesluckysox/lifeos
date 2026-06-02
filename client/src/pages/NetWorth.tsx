import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Plus, Trash2, Edit2, Check, X, Building2, Car, Banknote, LineChart, CreditCard, GraduationCap, Home } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";

/* ── Types ─────────────────────────────────────────────────────────── */
interface NWEntry { id: number; kind: string; label: string; value: number; notes?: string; }

const KIND_META: Record<string, { label: string; icon: React.ReactNode; group: "asset" | "debt"; color: string; }> = {
  asset_investment: { label: "Investments",    icon: <LineChart size={13} />,    group: "asset", color: "text-blue" },
  asset_cash:       { label: "Cash & Savings", icon: <Banknote size={13} />,     group: "asset", color: "text-green" },
  asset_property:   { label: "Real Estate",    icon: <Home size={13} />,         group: "asset", color: "text-teal" },
  asset_vehicle:    { label: "Vehicles",       icon: <Car size={13} />,          group: "asset", color: "text-gold" },
  asset_other:      { label: "Other Assets",   icon: <Building2 size={13} />,    group: "asset", color: "text-muted-foreground" },
  debt_mortgage:    { label: "Mortgage",       icon: <Home size={13} />,         group: "debt",  color: "text-rose" },
  debt_auto:        { label: "Auto Loan",      icon: <Car size={13} />,          group: "debt",  color: "text-rose" },
  debt_student:     { label: "Student Loans",  icon: <GraduationCap size={13} />,group: "debt",  color: "text-rose" },
  debt_credit:      { label: "Credit Cards",   icon: <CreditCard size={13} />,   group: "debt",  color: "text-rose" },
  debt_other:       { label: "Other Debt",     icon: <Building2 size={13} />,    group: "debt",  color: "text-rose" },
};

const KIND_GROUPS = {
  asset: Object.entries(KIND_META).filter(([, v]) => v.group === "asset").map(([k]) => k),
  debt:  Object.entries(KIND_META).filter(([, v]) => v.group === "debt").map(([k]) => k),
};

function fmt(n: number) {
  return "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/* ── Row component ─────────────────────────────────────────────────── */
function EntryRow({ entry, onDelete, onSave }: {
  entry: NWEntry;
  onDelete: (id: number) => void;
  onSave: (id: number, label: string, value: number, notes?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ label: entry.label, value: entry.value.toString(), notes: entry.notes ?? "" });
  const meta = KIND_META[entry.kind];

  const commit = () => {
    onSave(entry.id, draft.label, parseFloat(draft.value) || 0, draft.notes || undefined);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-card px-3 py-2">
        <input value={draft.label} onChange={e => setDraft(p => ({ ...p, label: e.target.value }))}
          className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" placeholder="Label" />
        <input value={draft.value} onChange={e => setDraft(p => ({ ...p, value: e.target.value }))}
          className="w-28 bg-transparent text-sm font-mono tabular text-right focus:outline-none" placeholder="0" type="number" />
        <button onClick={commit} className="text-green p-1"><Check size={13} /></button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground p-1"><X size={13} /></button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <span className={`${meta?.color ?? "text-muted-foreground"} shrink-0`}>{meta?.icon}</span>
      <span className="flex-1 min-w-0 text-sm truncate">{entry.label}</span>
      <span className={`font-mono text-sm tabular shrink-0 ${meta?.group === "asset" ? "text-foreground" : "text-rose"}`}>
        {meta?.group === "debt" ? "-" : ""}{fmt(entry.value)}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-blue p-1"><Edit2 size={12} /></button>
        <button onClick={() => onDelete(entry.id)} className="text-muted-foreground hover:text-rose p-1"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

/* ── Add entry form ─────────────────────────────────────────────────── */
function AddEntryForm({ onAdd, onCancel }: { onAdd: (kind: string, label: string, value: number) => void; onCancel: () => void; }) {
  const [kind, setKind] = useState("asset_cash");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-card px-3 py-2">
      <select value={kind} onChange={e => setKind(e.target.value)}
        className="bg-transparent text-xs font-mono focus:outline-none text-muted-foreground">
        {Object.entries(KIND_META).map(([k, v]) => (
          <option key={k} value={k}>{v.group === "debt" ? "Debt: " : ""}{v.label}</option>
        ))}
      </select>
      <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Chase checking)"
        className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" />
      <input value={value} onChange={e => setValue(e.target.value)} placeholder="0" type="number"
        className="w-28 bg-transparent text-sm font-mono tabular text-right focus:outline-none" />
      <button onClick={() => { if (label && value) { onAdd(kind, label, parseFloat(value)); }}} className="text-green p-1" disabled={!label || !value}><Check size={13} /></button>
      <button onClick={onCancel} className="text-muted-foreground p-1"><X size={13} /></button>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */
export default function NetWorth() {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);

  const { data: entries = [], isLoading } = useQuery<NWEntry[]>({
    queryKey: ["/api/net-worth"],
    queryFn: async () => (await apiRequest("GET", "/api/net-worth")).json(),
    enabled: !!user,
  });

  const saveMutation = useMutation({
    mutationFn: async (body: any) => apiRequest("POST", "/api/net-worth", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/net-worth"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/net-worth/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/net-worth"] }),
  });

  /* Derived */
  const totalAssets = entries.filter(e => KIND_META[e.kind]?.group === "asset").reduce((s, e) => s + e.value, 0);
  const totalDebt   = entries.filter(e => KIND_META[e.kind]?.group === "debt").reduce((s, e) => s + e.value, 0);
  const netWorth    = totalAssets - totalDebt;

  const byKind = (kind: string) => entries.filter(e => e.kind === kind);

  /* Group assets by kind for the breakdown bar */
  const assetGroups = KIND_GROUPS.asset.map(k => ({
    kind: k, meta: KIND_META[k], total: byKind(k).reduce((s, e) => s + e.value, 0),
  })).filter(g => g.total > 0);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <div className="eyebrow mb-2">Finance</div>
        <h1 className="font-display text-3xl">Net Worth</h1>
        <p className="mt-1 text-sm text-muted-foreground">Total picture — investments, cash, property, and debt.</p>
      </div>

      {/* Hero number */}
      <div className="dash-card p-6">
        <div className="eyebrow mb-2">Total net worth</div>
        <div className={`font-display text-[clamp(2.5rem,6vw,4rem)] leading-none tabular ${netWorth >= 0 ? "text-foreground" : "text-rose"}`}
          data-testid="net-worth-total">
          {netWorth < 0 ? "-" : ""}{fmt(netWorth)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-border/40">
          <div>
            <div className="eyebrow mb-1">Total assets</div>
            <div className="font-display text-xl tabular text-green">{fmt(totalAssets)}</div>
          </div>
          <div>
            <div className="eyebrow mb-1">Total debt</div>
            <div className="font-display text-xl tabular text-rose">-{fmt(totalDebt)}</div>
          </div>
        </div>
        {/* Asset breakdown bar */}
        {totalAssets > 0 && assetGroups.length > 1 && (
          <div className="mt-4 pt-4 border-t border-border/40">
            <div className="eyebrow mb-2">Asset breakdown</div>
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              {assetGroups.map(g => (
                <div
                  key={g.kind}
                  title={`${g.meta.label}: ${fmt(g.total)}`}
                  className="h-full transition-all"
                  style={{ width: `${(g.total / totalAssets) * 100}%`, background: `hsl(var(--${g.kind === "asset_investment" ? "accent-blue" : g.kind === "asset_cash" ? "accent-green" : g.kind === "asset_property" ? "accent-teal" : "accent-gold"}))` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {assetGroups.map(g => (
                <div key={g.kind} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                  <span className={g.meta.color}>{g.meta.icon}</span>
                  {g.meta.label} · {fmt(g.total)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Assets section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 eyebrow">
            <TrendingUp size={12} className="text-green" /> Assets
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1.5 text-xs text-blue hover:text-blue/80 transition-colors font-mono uppercase tracking-wider"
          >
            <Plus size={12} /> Add entry
          </button>
        </div>

        {showAdd && (
          <div className="mb-2">
            <AddEntryForm
              onAdd={(kind, label, value) => { saveMutation.mutate({ kind, label, value }); setShowAdd(false); }}
              onCancel={() => setShowAdd(false)}
            />
          </div>
        )}

        <div className="space-y-4">
          {KIND_GROUPS.asset.map(k => {
            const rows = byKind(k);
            if (rows.length === 0) return null;
            const meta = KIND_META[k];
            return (
              <div key={k}>
                <div className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider mb-2 ${meta.color}`}>
                  {meta.icon} {meta.label}
                </div>
                <div className="space-y-1.5">
                  {rows.map(e => (
                    <EntryRow
                      key={e.id} entry={e}
                      onDelete={id => deleteMutation.mutate(id)}
                      onSave={(id, label, value, notes) => saveMutation.mutate({ id, kind: e.kind, label, value, notes })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {!isLoading && entries.filter(e => KIND_META[e.kind]?.group === "asset").length === 0 && (
            <div className="text-xs text-muted-foreground italic py-2">No assets added yet. Click "Add entry" to start.</div>
          )}
        </div>
      </div>

      {/* Debt section */}
      <div>
        <div className="flex items-center gap-2 eyebrow mb-3">
          <TrendingDown size={12} className="text-rose" /> Debt
        </div>
        <div className="space-y-4">
          {KIND_GROUPS.debt.map(k => {
            const rows = byKind(k);
            if (rows.length === 0) return null;
            const meta = KIND_META[k];
            return (
              <div key={k}>
                <div className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider mb-2 ${meta.color}`}>
                  {meta.icon} {meta.label}
                </div>
                <div className="space-y-1.5">
                  {rows.map(e => (
                    <EntryRow
                      key={e.id} entry={e}
                      onDelete={id => deleteMutation.mutate(id)}
                      onSave={(id, label, value, notes) => saveMutation.mutate({ id, kind: e.kind, label, value, notes })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {!isLoading && entries.filter(e => KIND_META[e.kind]?.group === "debt").length === 0 && (
            <div className="text-xs text-muted-foreground italic py-2">No debt entries. Add mortgages, loans, or credit card balances here.</div>
          )}
        </div>
      </div>
    </div>
  );
}
