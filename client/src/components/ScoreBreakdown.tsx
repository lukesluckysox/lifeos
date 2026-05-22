import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ScoreComponents } from "@/data/score";
import { weights } from "@/data/score";

interface Props {
  total: number;
  components: ScoreComponents;
  reasons: string[];
}

const ROWS: { key: keyof ScoreComponents; label: string }[] = [
  { key: "affinity", label: "Affinity" },
  { key: "adjacency", label: "Adjacency" },
  { key: "recency", label: "Recency" },
  { key: "novelty", label: "Novelty" },
];

export function ScoreBreakdown({ total, components, reasons }: Props) {
  const [open, setOpen] = useState(false);
  const pct = Math.round(total * 100);

  return (
    <div className="mt-3">
      <button
        type="button"
        data-testid="button-toggle-why"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="text-teal tabular">{pct}%</span>
        <span>match</span>
        <span className="opacity-60">·</span>
        <span>{open ? "hide" : "show"} why</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 rounded-md border border-border bg-secondary/30 p-3 space-y-2.5">
          {ROWS.map(({ key, label }) => {
            const v = components[key];
            const w = weights[key];
            const contribution = Math.round(v * w * 100);
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground w-20 shrink-0">{label}</div>
                <div className="flex-1 h-[3px] bg-border/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal"
                    style={{ width: `${Math.round(v * 100)}%`, transition: "width 400ms cubic-bezier(0.16,1,0.3,1)" }}
                  />
                </div>
                <div className="font-mono text-[10px] tabular w-16 text-right text-muted-foreground">
                  <span className="text-foreground/80">{contribution}</span>
                  <span className="opacity-60"> / {Math.round(w * 100)}</span>
                </div>
              </div>
            );
          })}
          <div className="pt-2 mt-2 border-t border-border/60 space-y-1">
            {reasons.map((r, i) => (
              <div key={i} className="text-[11px] text-muted-foreground leading-relaxed">— {r}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
