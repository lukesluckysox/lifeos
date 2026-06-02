import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Target, Plus, Trash2, Check, ChevronRight, Pencil, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";

/* ── Types ─────────────────────────────────────────────────────────── */
interface Goal {
  id: number; title: string; category: string;
  target_value: number; current_value: number;
  unit: string; deadline?: string; notes?: string; completed: number;
}

const CATEGORIES = [
  { id: "finance",  label: "Finance",  color: "text-blue  border-blue/30  bg-blue/10"  },
  { id: "fitness",  label: "Fitness",  color: "text-green border-green/30 bg-green/10" },
  { id: "learning", label: "Learning", color: "text-gold  border-gold/30  bg-gold/10"  },
  { id: "travel",   label: "Travel",   color: "text-teal  border-teal/30  bg-teal/10"  },
  { id: "health",   label: "Health",   color: "text-green border-green/30 bg-green/10" },
  { id: "creative", label: "Creative", color: "text-rose  border-rose/30  bg-rose/10"  },
  { id: "other",    label: "Other",    color: "text-muted-foreground border-border bg-muted/30" },
];

const CAT_COLOR = Object.fromEntries(CATEGORIES.map(c => [c.id, c.color]));

function catColor(cat: string) {
  return CAT_COLOR[cat] ?? "text-muted-foreground border-border bg-muted/30";
}

function pct(current: number, target: number) {
  if (target === 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function GoalCard({ goal, onUpdate, onDelete }: {
  goal: Goal;
  onUpdate: (patch: Partial<Goal>) => void;
  onDelete: () => void;
}) {
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressDraft, setProgressDraft] = useState(goal.current_value.toString());
  const progress = pct(goal.current_value, goal.target_value);
  const done = goal.completed === 1 || progress >= 100;
  const color = catColor(goal.category);

  return (
    <div
      className={`dash-card overflow-hidden transition-opacity ${done ? "opacity-60" : ""}`}
      data-testid={`goal-card-${goal.id}`}
    >
      <div className="dash-card-header flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider shrink-0 mt-0.5 ${color}`}>
            {goal.category}
          </span>
          <span className={`font-semibold text-sm leading-snug ${done ? "line-through text-muted-foreground" : ""}`}>
            {goal.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {done ? (
            <span className="text-[10px] font-mono uppercase tracking-wider text-green border border-green/30 rounded px-1.5 py-0.5">Done</span>
          ) : (
            <button
              onClick={() => onUpdate({ completed: 1 })}
              className="text-muted-foreground/50 hover:text-green transition-colors p-0.5"
              title="Mark complete"
            >
              <Check size={13} />
            </button>
          )}
          <button onClick={onDelete} className="text-muted-foreground/40 hover:text-rose transition-colors p-0.5">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="px-4 py-4 space-y-3">
        {/* Progress bar */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="font-mono text-xs tabular text-muted-foreground">
              {goal.current_value.toLocaleString()} / {goal.target_value.toLocaleString()} {goal.unit}
            </div>
            <div className={`font-mono text-sm tabular font-medium ${done ? "text-green" : "text-foreground"}`}>
              {progress}%
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${done ? "bg-green" : "bg-blue"}`}
              style={{ width: `${progress}%` }}
              data-testid={`goal-progress-${goal.id}`}
            />
          </div>
        </div>

        {/* Update progress */}
        {!done && (
          <div className="flex items-center gap-2">
            {editingProgress ? (
              <>
                <input
                  type="number"
                  value={progressDraft}
                  onChange={e => setProgressDraft(e.target.value)}
                  className="w-28 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono tabular focus:outline-none focus:border-blue/50 transition-colors"
                  autoFocus
                />
                <span className="text-xs text-muted-foreground">{goal.unit}</span>
                <button
                  onClick={() => {
                    onUpdate({ current_value: parseFloat(progressDraft) || 0 });
                    setEditingProgress(false);
                  }}
                  className="text-green p-1"
                >
                  <Check size={13} />
                </button>
                <button onClick={() => setEditingProgress(false)} className="text-muted-foreground p-1">
                  <X size={13} />
                </button>
              </>
            ) : (
              <button
                onClick={() => { setProgressDraft(goal.current_value.toString()); setEditingProgress(true); }}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-blue transition-colors font-mono uppercase tracking-wider"
              >
                <Pencil size={11} /> Update progress
              </button>
            )}
          </div>
        )}

        {/* Deadline */}
        {goal.deadline && (
          <div className="text-[11px] font-mono text-muted-foreground">
            By {new Date(goal.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {!done && (() => {
              const daysLeft = Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400000);
              return daysLeft >= 0
                ? <span className={`ml-1 ${daysLeft < 14 ? "text-gold" : ""}`}>· {daysLeft}d left</span>
                : <span className="ml-1 text-rose">· {Math.abs(daysLeft)}d overdue</span>;
            })()}
          </div>
        )}

        {goal.notes && <div className="text-xs text-muted-foreground leading-relaxed">{goal.notes}</div>}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */
export default function Goals() {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<"active" | "completed" | "all">("active");
  const [form, setForm] = useState({
    title: "", category: "finance", targetValue: "", currentValue: "0", unit: "", deadline: "", notes: "",
  });

  const { data: goals = [], isLoading } = useQuery<Goal[]>({
    queryKey: ["/api/goals"],
    queryFn: async () => (await apiRequest("GET", "/api/goals")).json(),
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/goals", {
      ...form,
      targetValue: parseFloat(form.targetValue),
      currentValue: parseFloat(form.currentValue) || 0,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      setShowAdd(false);
      setForm({ title: "", category: "finance", targetValue: "", currentValue: "0", unit: "", deadline: "", notes: "" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: any }) =>
      apiRequest("PATCH", `/api/goals/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/goals"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/goals"] }),
  });

  const active    = goals.filter(g => g.completed === 0 && pct(g.current_value, g.target_value) < 100);
  const completed = goals.filter(g => g.completed === 1 || pct(g.current_value, g.target_value) >= 100);
  const visible   = filter === "active" ? active : filter === "completed" ? completed : goals;

  const overallProgress = active.length === 0 ? 0
    : Math.round(active.reduce((s, g) => s + pct(g.current_value, g.target_value), 0) / active.length);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Progress</div>
          <h1 className="font-display text-3xl">Goals</h1>
          <p className="mt-1 text-sm text-muted-foreground">What you're working toward, tracked in one place.</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-blue/30 hover:text-blue transition-colors"
          data-testid="button-add-goal"
        >
          <Plus size={14} /> Add goal
        </button>
      </div>

      {/* Summary */}
      {goals.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Active", value: active.length.toString() },
            { label: "Completed", value: completed.length.toString() },
            { label: "Avg progress", value: `${overallProgress}%` },
          ].map(s => (
            <div key={s.label} className="dash-card p-4">
              <div className="eyebrow mb-1">{s.label}</div>
              <div className="font-display text-2xl tabular">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="dash-card overflow-hidden" data-testid="form-add-goal">
          <div className="dash-card-header px-5 py-3">
            <span className="text-sm font-semibold">New goal</span>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="eyebrow block mb-1">Goal title</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Save $10,000"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors"
                  data-testid="input-goal-title" />
              </div>
              <div>
                <label className="eyebrow block mb-1">Category</label>
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors">
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="eyebrow block mb-1">Target</label>
                <input type="number" value={form.targetValue} onChange={e => setForm(p => ({ ...p, targetValue: e.target.value }))}
                  placeholder="10000"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono tabular focus:outline-none focus:border-blue/50 transition-colors" />
              </div>
              <div>
                <label className="eyebrow block mb-1">Current</label>
                <input type="number" value={form.currentValue} onChange={e => setForm(p => ({ ...p, currentValue: e.target.value }))}
                  placeholder="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono tabular focus:outline-none focus:border-blue/50 transition-colors" />
              </div>
              <div>
                <label className="eyebrow block mb-1">Unit</label>
                <input value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                  placeholder="USD, lbs, books…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors" />
              </div>
              <div>
                <label className="eyebrow block mb-1">Deadline</label>
                <input type="date" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors" />
              </div>
            </div>
            <div>
              <label className="eyebrow block mb-1">Notes (optional)</label>
              <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Any context or motivation"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors" />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => addMutation.mutate()}
                disabled={!form.title || !form.targetValue || !form.unit || addMutation.isPending}
                className="rounded-lg bg-blue text-white px-4 py-2 text-sm font-medium disabled:opacity-40 transition-opacity"
                data-testid="button-save-goal"
              >
                {addMutation.isPending ? "Saving..." : "Save goal"}
              </button>
              <button onClick={() => setShowAdd(false)} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      {goals.length > 0 && (
        <div className="flex gap-1 border-b border-border">
          {(["active", "completed", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors border-b-2 -mb-px ${
                filter === f ? "border-blue text-blue" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "active" ? `Active (${active.length})` : f === "completed" ? `Completed (${completed.length})` : "All"}
            </button>
          ))}
        </div>
      )}

      {/* Goal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {isLoading && <div className="text-sm text-muted-foreground animate-pulse col-span-full">Loading...</div>}
        {!isLoading && visible.length === 0 && goals.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border p-10 text-center">
            <Target size={32} className="mx-auto text-muted-foreground/30 mb-3" />
            <div className="text-sm font-medium mb-1">No goals yet</div>
            <div className="text-xs text-muted-foreground">Add your first goal — financial, fitness, learning, or anything else.</div>
          </div>
        )}
        {visible.map(goal => (
          <GoalCard
            key={goal.id}
            goal={goal}
            onUpdate={patch => updateMutation.mutate({ id: goal.id, patch })}
            onDelete={() => deleteMutation.mutate(goal.id)}
          />
        ))}
      </div>
    </div>
  );
}
