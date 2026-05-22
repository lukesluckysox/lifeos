import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, Sparkles, TrendingUp, TrendingDown, Layers, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useMode } from "@/components/ModeProvider";
import { SectionHeader } from "@/components/SectionHeader";

type Severity = "info" | "watch" | "alert";

interface Insight {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
}

interface InsightsResp {
  asOf: string;
  totalValue: number;
  insights: Insight[];
}

const SEV_STYLES: Record<Severity, { border: string; bg: string; chip: string; chipLabel: string; icon: string }> = {
  info: {
    border: "border-border",
    bg: "bg-card",
    chip: "border-teal/40 bg-teal/10 text-teal",
    chipLabel: "info",
    icon: "text-teal",
  },
  watch: {
    border: "border-gold/30",
    bg: "bg-gold/[0.04]",
    chip: "border-gold/40 bg-gold/10 text-gold",
    chipLabel: "watch",
    icon: "text-gold",
  },
  alert: {
    border: "border-destructive/40",
    bg: "bg-destructive/[0.04]",
    chip: "border-destructive/40 bg-destructive/10 text-destructive",
    chipLabel: "alert",
    icon: "text-destructive",
  },
};

function iconFor(kind: string, sev: Severity) {
  if (kind === "concentration") return AlertTriangle;
  if (kind === "mover") return sev === "alert" ? TrendingDown : TrendingUp;
  if (kind === "loser") return TrendingDown;
  if (kind === "sub-yield") return Eye;
  if (kind === "dust") return Trash2;
  return Sparkles;
}

export function FinanceInsights() {
  const { mode, withMode } = useMode();
  const { data, isLoading } = useQuery<InsightsResp>({
    queryKey: ["/api/finance-insights", mode],
    queryFn: async () => (await apiRequest("GET", withMode("/api/finance-insights"))).json(),
  });

  const insights = data?.insights ?? [];

  // Sort: alert > watch > info
  const order: Record<Severity, number> = { alert: 0, watch: 1, info: 2 };
  const sorted = [...insights].sort((a, b) => order[a.severity] - order[b.severity]);

  if (isLoading) {
    return (
      <section>
        <SectionHeader eyebrow="Advisory" title="What I'd flag" description="Read your portfolio like a third party would." />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card/40 p-5 h-32 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (sorted.length === 0) {
    return (
      <section>
        <SectionHeader eyebrow="Advisory" title="What I'd flag" description="Read your portfolio like a third party would." />
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground" data-testid="finance-insights-empty">
          <Layers size={14} className="inline-block mr-2 -mt-0.5 text-muted-foreground" />
          Nothing structural to flag right now &mdash; no concentration, no deep losers, no day-of shocks.
        </div>
      </section>
    );
  }

  const counts = {
    alert: sorted.filter((i) => i.severity === "alert").length,
    watch: sorted.filter((i) => i.severity === "watch").length,
    info: sorted.filter((i) => i.severity === "info").length,
  };

  return (
    <section data-testid="finance-insights">
      <SectionHeader
        eyebrow="Advisory"
        title="What I'd flag"
        description="Read your portfolio like a third party would &mdash; concentration, losers, and structural drag."
      >
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
          {counts.alert > 0 && (
            <span className="px-2 py-0.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
              {counts.alert} alert
            </span>
          )}
          {counts.watch > 0 && (
            <span className="px-2 py-0.5 rounded-full border border-gold/40 bg-gold/10 text-gold">
              {counts.watch} watch
            </span>
          )}
          {counts.info > 0 && (
            <span className="px-2 py-0.5 rounded-full border border-teal/40 bg-teal/10 text-teal">
              {counts.info} info
            </span>
          )}
        </div>
      </SectionHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((ins, i) => {
          const s = SEV_STYLES[ins.severity];
          const Icon = iconFor(ins.kind, ins.severity);
          return (
            <div
              key={`${ins.kind}-${i}`}
              data-testid={`insight-card-${ins.kind}-${i}`}
              className={`rounded-lg border ${s.border} ${s.bg} p-4 flex flex-col gap-2`}
            >
              <div className="flex items-start justify-between gap-2">
                <Icon size={14} className={`shrink-0 ${s.icon} mt-0.5`} />
                <span
                  className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${s.chip}`}
                >
                  {s.chipLabel}
                </span>
              </div>
              <div className="font-display text-base leading-tight">{ins.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{ins.detail}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
