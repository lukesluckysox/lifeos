import { ArrowUpRight, Sparkles } from "lucide-react";
import { Link } from "wouter";

/**
 * Changelog page. Hand-curated, newest first. Each entry is a short
 * editorial paragraph rather than a bullet list — feels less like
 * a GitHub release and more like a product note.
 */
const RELEASES: Array<{
  version: string;
  date: string;
  title: string;
  body: string;
  highlights: string[];
}> = [
  {
    version: "v0.4",
    date: "May 2026",
    title: "Radius is a name now.",
    body:
      "Renamed from Life-OS to Radius. New logo, new landing page, new tagline (your money, your music, your places — in one place). Friendlier error messages everywhere. Subscriptions now read your real Plaid transactions instead of a fixture. Music genre rollups collapse Spotify's micro-genres into clean parent buckets. The Home page now greets you by name with a count-up animation on the day's portfolio change.",
    highlights: [
      "New brand: Radius, with logo + OG card",
      "Real Plaid-powered subscription detection",
      "Music genre rollups: ~14 parent buckets instead of ~40 micro-genres",
      "Hero greeting + day-change count-up animation on Home",
      "First-run onboarding checklist",
      "Friendlier Plaid + Ask Lumen errors (no raw HTTP codes)",
    ],
  },
  {
    version: "v0.3",
    date: "May 2026",
    title: "Ask Lumen actually reads your data.",
    body:
      "Fixed two silent bugs where the AI assistant was calling Spotify and Plaid functions that didn't exist — so it answered every question from general knowledge alone. It now pulls your real holdings, watchlist, subscriptions, places, saved items, and recently played tracks before responding. Also switched to claude-sonnet-4-6 for higher quality answers.",
    highlights: [
      "Ask Lumen now reads holdings, watchlist, subscriptions, places, music",
      "Spotify + Google sign-in cross-link by email (no more duplicate accounts)",
      "Claude model upgraded to claude-sonnet-4-6",
    ],
  },
  {
    version: "v0.2",
    date: "May 2026",
    title: "Plaid OAuth, finally working.",
    body:
      "Spent a long weekend fixing the dreaded Plaid 'blue screen' on OAuth bank returns. The fix was to stash the original link_token on the server and resume with it on return, not generate a fresh one. Also added cost-basis normalization (per-share × quantity) and the Schwab/Coinbase split.",
    highlights: [
      "Plaid OAuth resume flow (no more blue screen)",
      "Cost-basis normalization for accurate gain/loss",
      "Institution grouping (Schwab / Coinbase)",
    ],
  },
];

export default function WhatsNew() {
  return (
    <div className="space-y-12 animate-fade-in max-w-3xl" data-testid="page-whats-new">
      <section className="pt-2">
        <div className="eyebrow mb-4 flex items-center gap-2">
          <Sparkles size={11} className="text-teal" />
          <span>Changelog</span>
        </div>
        <h1 className="font-display text-[clamp(1.875rem,4vw,3rem)] leading-[1.05] tracking-tight">
          What's new in <span className="text-teal italic">Radius</span>.
        </h1>
        <p className="mt-3 text-base text-muted-foreground max-w-2xl leading-relaxed">
          Small, frequent updates. Nothing shipped without notes. Built one weekend at a time from Pearl City, Hawaii.
        </p>
      </section>

      <div className="hairline" />

      <section className="space-y-12">
        {RELEASES.map((r, idx) => (
          <article
            key={r.version}
            className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-6 md:gap-10"
            data-testid={`release-${r.version}`}
          >
            <div className="space-y-1">
              <div className="font-mono text-xs tabular text-teal" data-testid={`text-version-${r.version}`}>
                {r.version}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {r.date}
              </div>
              {idx === 0 && (
                <span className="inline-block mt-2 rounded bg-teal/15 border border-teal/30 text-teal px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider">
                  current
                </span>
              )}
            </div>
            <div className="space-y-4">
              <h2 className="font-display text-xl leading-tight">{r.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{r.body}</p>
              <ul className="space-y-1.5">
                {r.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm leading-snug"
                    data-testid={`highlight-${r.version}-${i}`}
                  >
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-teal shrink-0" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </section>

      <div className="hairline" />

      <footer className="pb-12">
        <Link href="/">
          <span
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-teal transition-colors cursor-pointer"
            data-testid="link-back-home"
          >
            Back to dashboard
            <ArrowUpRight size={12} />
          </span>
        </Link>
      </footer>
    </div>
  );
}
