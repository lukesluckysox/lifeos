import { useMemo } from "react";
import { entities, relations, Entity } from "@/data/graph";

/**
 * Force-positioned-ish constellation of the user's identity graph.
 * We don't run a real force layout — we lay nodes out deterministically
 * by domain ring so it always reads cleanly and reproducibly.
 */
export function TasteConstellation() {
  const nodes = useMemo(() => {
    const liked = new Set(
      relations
        .filter((r) => r.from === "user" && (r.kind === "likes" || r.kind === "visited" || r.kind === "owns"))
        .map((r) => r.to),
    );

    const ringOf: Record<string, { ring: number; color: string }> = {
      artist: { ring: 1, color: "var(--accent-teal)" },
      director: { ring: 1, color: "var(--accent-teal)" },
      actor: { ring: 1, color: "var(--accent-teal)" },
      film: { ring: 2, color: "var(--accent-rose)" },
      show: { ring: 2, color: "var(--accent-rose)" },
      place: { ring: 3, color: "var(--accent-gold)" },
      account: { ring: 4, color: "var(--foreground)" },
      holding: { ring: 4, color: "var(--foreground)" },
      theme: { ring: 0, color: "var(--accent-teal)" },
    };

    const list = entities
      .filter((e) => liked.has(e.id) || e.kind === "theme")
      .map((e) => ({
        entity: e,
        ring: ringOf[e.kind]?.ring ?? 3,
        color: ringOf[e.kind]?.color ?? "var(--foreground)",
      }));

    // group by ring then distribute angles
    const byRing: Record<number, typeof list> = {};
    for (const n of list) {
      (byRing[n.ring] ||= []).push(n);
    }
    const positioned: Array<{ e: Entity; x: number; y: number; r: number; color: string; size: number }> = [];
    const ringRadius = [0, 80, 145, 205, 260];
    for (const [ringStr, arr] of Object.entries(byRing)) {
      const ring = Number(ringStr);
      const R = ringRadius[ring] ?? 220;
      arr.forEach((n, i) => {
        const angle = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
        positioned.push({
          e: n.entity,
          x: 320 + Math.cos(angle) * R,
          y: 260 + Math.sin(angle) * R * 0.78,
          r: R,
          color: n.color,
          size: ring === 0 ? 5 : ring === 4 ? 2.5 : 3.5,
        });
      });
    }
    return positioned;
  }, []);

  const lines = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.e.id, n]));
    const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const r of relations) {
      const a = map.get(r.from);
      const b = map.get(r.to);
      if (a && b) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return out;
  }, [nodes]);

  return (
    <div className="relative rounded-lg border border-border bg-card/40 overflow-hidden">
      <svg viewBox="0 0 640 520" className="w-full h-[420px]" role="img" aria-label="Taste constellation">
        <defs>
          <radialGradient id="atmo" cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="hsl(var(--accent-teal))" stopOpacity="0.08" />
            <stop offset="60%" stopColor="hsl(var(--accent-teal))" stopOpacity="0.0" />
          </radialGradient>
        </defs>
        <rect width="640" height="520" fill="url(#atmo)" />

        {/* concentric guide rings */}
        {[80, 145, 205, 260].map((r) => (
          <ellipse key={r} cx="320" cy="260" rx={r} ry={r * 0.78} fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" strokeDasharray="2 4" opacity="0.6" />
        ))}

        {/* edges */}
        <g opacity="0.35">
          {lines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="hsl(var(--muted-foreground))" strokeWidth="0.4" />
          ))}
        </g>

        {/* nodes */}
        {nodes.map((n, i) => (
          <g key={n.e.id} style={{ animation: `fade-in 0.6s ${0.02 * i}s both` }}>
            <circle cx={n.x} cy={n.y} r={n.size + 4} fill={`hsl(${n.color})`} opacity="0.12" />
            <circle cx={n.x} cy={n.y} r={n.size} fill={`hsl(${n.color})`} />
            <text
              x={n.x}
              y={n.y + n.size + 11}
              textAnchor="middle"
              fontSize="9"
              fill="hsl(var(--muted-foreground))"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {n.e.name.length > 18 ? n.e.name.slice(0, 16) + "…" : n.e.name}
            </text>
          </g>
        ))}

        {/* center: you */}
        <circle cx="320" cy="260" r="14" fill="hsl(var(--background))" stroke="hsl(var(--accent-gold))" strokeWidth="1" />
        <text x="320" y="263" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="2" fill="hsl(var(--accent-gold))">
          YOU
        </text>
      </svg>

      <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-center gap-4 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-teal" />Music</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-rose" />Film</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-gold" />Places</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-foreground/60" />Finance</span>
      </div>
    </div>
  );
}
