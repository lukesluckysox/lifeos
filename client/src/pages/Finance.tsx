import { ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { entities, relations } from "@/data/graph";
import { financeSignals } from "@/data/recs";

export default function Finance() {
  const accounts = entities.filter((e) => e.kind === "account");
  const holdings = entities
    .filter((e) => e.kind === "holding")
    .sort((a, b) => Number(b.meta?.weight) - Number(a.meta?.weight));
  const totalValue = accounts.reduce((acc, a) => acc + Number(a.meta?.value ?? 0), 0);
  const signals = financeSignals();

  return (
    <div className="space-y-14 animate-fade-in">
      {/* Hero */}
      <section>
        <div className="eyebrow mb-3">Finance</div>
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">Net worth · USD</div>
            <div className="font-display text-[clamp(2.5rem,5vw,4rem)] leading-none tabular">
              ${totalValue.toLocaleString()}
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <TrendingUp size={14} className="text-teal" />
              <span className="text-teal tabular font-mono">+$3,240</span>
              <span className="text-muted-foreground">this week</span>
            </div>
          </div>
          <div className="flex gap-8">
            <Metric label="Liquid" value="$14.25K" sub="checking" />
            <Metric label="Brokerage" value="$184.3K" sub="taxable" />
            <Metric label="Retirement" value="$62.4K" sub="roth ira" />
          </div>
        </div>
      </section>

      <div className="hairline" />

      {/* Allocation visualization */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-10">
        <div>
          <SectionHeader eyebrow="Allocation" title="Where it sits" />
          <AllocationBar holdings={holdings} />
          <div className="mt-6 space-y-2">
            {holdings.map((h) => {
              const change = Number(h.meta?.change);
              return (
                <div key={h.id} className="flex items-center gap-4 text-sm py-2 border-b border-border/50 last:border-0">
                  <div className="font-mono text-foreground font-medium w-16">{h.name}</div>
                  <div className="flex-1 h-[2px] bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-teal" style={{ width: `${Number(h.meta?.weight) * 3}%` }} />
                  </div>
                  <div className="font-mono tabular text-muted-foreground w-12 text-right">{h.meta?.weight}%</div>
                  <div className={`font-mono tabular w-16 text-right ${change >= 0 ? "text-teal" : "text-rose"}`}>
                    {change >= 0 ? "+" : ""}
                    {change}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <SectionHeader eyebrow="Watching" title="What's moving" />
          <div className="space-y-2">
            {holdings
              .slice()
              .sort((a, b) => Math.abs(Number(b.meta?.change)) - Math.abs(Number(a.meta?.change)))
              .slice(0, 4)
              .map((h) => {
                const change = Number(h.meta?.change);
                const positive = change >= 0;
                return (
                  <div key={h.id} className="rounded-lg border border-border bg-card p-4 flex items-center gap-5">
                    <div className="font-display text-2xl tabular w-16">{h.name}</div>
                    <div className="flex-1">
                      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        {positive ? "rising" : "drifting"}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {h.meta?.weight}% of brokerage
                      </div>
                    </div>
                    <div className={`font-mono tabular text-lg ${positive ? "text-teal" : "text-rose"} flex items-center gap-1`}>
                      {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                      {positive ? "+" : ""}
                      {change}%
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </section>

      {/* Read of the situation */}
      <section>
        <SectionHeader eyebrow="Read" title="The short version" />
        <div className="rounded-lg border border-border bg-card p-6 max-w-3xl">
          <p className="font-display text-xl leading-snug text-foreground">
            You're <span className="italic text-teal">concentrated in tech</span> — {signals.topConcentration.holding?.name} is{" "}
            {signals.topConcentration.pct}% of your brokerage. {signals.biggestMover?.name} did most of the work this week ({signals.biggestMover?.meta?.change}%).
          </p>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            Cash & T-Bills sit at 10% — comfortable but not optimized for current rates. BTC drifted; not large enough to act on yet.
          </p>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="font-display text-2xl tabular leading-none">{value}</div>
      <div className="font-mono text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{sub}</div>
    </div>
  );
}

function AllocationBar({ holdings }: { holdings: any[] }) {
  const colors = ["bg-teal", "bg-gold", "bg-rose", "bg-foreground/60", "bg-muted-foreground/50", "bg-foreground/30"];
  return (
    <div>
      <div className="flex h-16 rounded-md overflow-hidden border border-border">
        {holdings.map((h, i) => (
          <div
            key={h.id}
            className={`${colors[i % colors.length]} relative group cursor-pointer transition-opacity hover:opacity-80`}
            style={{ width: `${Number(h.meta?.weight)}%` }}
            title={`${h.name} · ${h.meta?.weight}%`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] font-mono uppercase tracking-wider">
        {holdings.map((h, i) => (
          <span key={h.id} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${colors[i % colors.length]}`} />
            {h.name}
          </span>
        ))}
      </div>
    </div>
  );
}
