import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CreditCard, Plus, Trash2, Search as SearchIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";
import { useToast } from "@/hooks/use-toast";

interface Sub {
  id?: number | string;
  name: string;
  amount: number;
  cadence: "monthly" | "yearly" | "weekly";
  category?: string;
  source: "manual" | "detected";
  nextCharge?: string;
  basedOn?: string;
}

interface SubsResp {
  detected: Sub[];
  manual: Sub[];
  all: Sub[];
  totalMonthly: number;
}

export default function Subscriptions() {
  const { mode, withMode } = useMode();
  const { toast } = useToast();

  const [form, setForm] = useState({ name: "", amount: "", cadence: "monthly", category: "" });
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading } = useQuery<SubsResp>({
    queryKey: ["/api/subscriptions", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/subscriptions"))).json(),
  });

  const addSub = useMutation({
    mutationFn: async (body: any) => (await apiRequest("POST", "/api/subscriptions", body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      toast({ title: "Added", description: "Subscription saved." });
      setForm({ name: "", amount: "", cadence: "monthly", category: "" });
      setShowAdd(false);
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const removeSub = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/subscriptions/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] }),
  });

  const detected = data?.detected ?? [];
  const manual = data?.manual ?? [];
  const total = data?.totalMonthly ?? 0;
  const yearly = total * 12;

  return (
    <div className="space-y-12 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Subscriptions {mode === "demo" && <span className="ml-2 text-gold">· demo</span>}</div>
        <h1 className="font-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight tracking-tight max-w-2xl">
          What you pay <span className="text-teal italic">every month</span>.
        </h1>
        <p className="text-sm text-muted-foreground mt-3 max-w-xl">
          Auto-detected from your transactions, plus anything you add manually. Find leaks, cancel quietly.
        </p>
      </section>

      {/* Total */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Tile label="Total · monthly" value={`$${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <Tile label="Projected · yearly" value={`$${yearly.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <Tile label="Active subscriptions" value={`${(detected.length + manual.length)}`} sub={`${detected.length} detected · ${manual.length} manual`} />
      </section>

      {/* Add */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div className="eyebrow">Manual entries</div>
          <button
            onClick={() => setShowAdd(s => !s)}
            data-testid="button-add-subscription"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-mono hover:bg-accent transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        </div>
        {showAdd && (
          <div className="rounded-lg border border-border bg-card p-5 max-w-xl mb-4" data-testid="form-add-sub">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="h-9 px-3 text-sm rounded-md bg-background border border-border" placeholder="Name (e.g. ChatGPT Plus)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-sub-name" />
              <input className="h-9 px-3 text-sm rounded-md bg-background border border-border" placeholder="Amount" type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-sub-amount" />
              <select className="h-9 px-3 text-sm rounded-md bg-background border border-border" value={form.cadence} onChange={e => setForm(f => ({ ...f, cadence: e.target.value }))} data-testid="select-sub-cadence">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="weekly">Weekly</option>
              </select>
              <input className="h-9 px-3 text-sm rounded-md bg-background border border-border" placeholder="Category (optional)" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} data-testid="input-sub-category" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => {
                  const amount = parseFloat(form.amount);
                  if (!form.name || !Number.isFinite(amount)) {
                    return toast({ title: "Name and amount required", variant: "destructive" });
                  }
                  addSub.mutate({ name: form.name, amount, cadence: form.cadence, category: form.category || null });
                }}
                disabled={addSub.isPending}
                data-testid="button-save-sub"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-teal text-background text-xs font-mono"
              >
                Save
              </button>
              <button onClick={() => setShowAdd(false)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {manual.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/40 px-5 py-6 text-sm text-muted-foreground text-center">
              Nothing manual yet. Anything missed by auto-detection? Add it here.
            </div>
          ) : manual.map(s => (
            <SubRow key={s.id as number} sub={s} onRemove={() => removeSub.mutate(s.id as number)} />
          ))}
        </div>
      </section>

      <section>
        <div className="eyebrow mb-3 flex items-center gap-2">
          <SearchIcon size={11} /> Detected from transactions
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Scanning your transactions…</div>
        ) : detected.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/40 px-5 py-6 text-sm text-muted-foreground text-center">
            No recurring charges found in your recent transactions.
          </div>
        ) : (
          <div className="space-y-2">
            {detected.map((s, i) => (
              <SubRow key={`d-${i}`} sub={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="font-display text-2xl tabular leading-none">{value}</div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">{sub}</div>}
    </div>
  );
}

function SubRow({ sub, onRemove }: { sub: Sub; onRemove?: () => void }) {
  const cadenceLabel = sub.cadence === "monthly" ? "/mo" : sub.cadence === "yearly" ? "/yr" : "/wk";
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3" data-testid={`row-sub-${sub.id ?? sub.name}`}>
      <CreditCard size={14} className="text-teal shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={sub.name}>{sub.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {sub.category || "—"}
          {sub.nextCharge && <> · next {sub.nextCharge}</>}
          {sub.basedOn && <> · {sub.basedOn}</>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono tabular text-sm">
          ${sub.amount.toFixed(2)}<span className="text-muted-foreground text-[10px]">{cadenceLabel}</span>
        </div>
        <div className={`font-mono text-[9px] uppercase tracking-wider mt-0.5 ${sub.source === "detected" ? "text-gold" : "text-teal"}`}>
          {sub.source}
        </div>
      </div>
      {onRemove && (
        <button onClick={onRemove} className="text-muted-foreground hover:text-rose ml-1" aria-label="Remove" data-testid={`button-remove-sub-${sub.id}`}>
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
