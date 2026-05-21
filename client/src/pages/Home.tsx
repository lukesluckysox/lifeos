import { Link } from "wouter";
import { ArrowUpRight, TrendingUp, Calendar, MapPin, Wallet, Sparkles, Activity } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { TasteConstellation } from "@/components/TasteConstellation";
import { musicRecs, filmRecs, placeRecs, financeSignals } from "@/data/recs";

export default function Home() {
  const music = musicRecs().slice(0, 1)[0];
  const film = filmRecs().slice(0, 1)[0];
  const place = placeRecs().slice(0, 1)[0];
  const fin = financeSignals();

  return (
    <div className="space-y-16 animate-fade-in">
      {/* ============ Editorial intro ============ */}
      <section className="pt-2">
        <div className="eyebrow mb-4">Wednesday · 7:26 PM HST</div>
        <h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] leading-[1.02] tracking-tight max-w-3xl">
          Three things <span className="text-teal italic">moved</span> in your world this week.
        </h1>
        <p className="mt-5 text-muted-foreground max-w-xl leading-relaxed">
          A new release from an artist you've replayed for six years. A film built around a
          director you've followed closely. A coast you haven't surfed yet, but that fits the pattern.
        </p>
      </section>

      <div className="hairline" />

      {/* ============ Now Relevant ============ */}
      <section>
        <SectionHeader
          eyebrow="Now relevant"
          title="What matters today"
          description="Surfaced from the graph beneath everything you've told this product about yourself."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border">
          {music && (
            <RelevantCard
              tag="Music"
              icon={Calendar}
              accent="teal"
              title={music.entity.name}
              date={String(music.entity.meta?.date ?? "")}
              reason={music.reason}
              href="/music"
            />
          )}
          {film && (
            <RelevantCard
              tag="Film"
              icon={Sparkles}
              accent="rose"
              title={film.entity.name}
              date={String(film.entity.meta?.year ?? "")}
              reason={film.reason}
              href="/film"
            />
          )}
          {place && (
            <RelevantCard
              tag="Places"
              icon={MapPin}
              accent="gold"
              title={place.entity.name}
              date={String(place.entity.meta?.region ?? "")}
              reason={place.reason}
              href="/places"
            />
          )}
        </div>
      </section>

      {/* ============ Taste Map + Trajectory ============ */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10">
        <div>
          <SectionHeader
            eyebrow="Taste constellation"
            title="The shape of you"
            description="Concentric rings: inner is taste, outer is finance. Lines are remembered connections."
          />
          <TasteConstellation />
        </div>
        <div>
          <SectionHeader
            eyebrow="Trajectory"
            title="Rising, fading, recurring"
          />
          <Trajectory />
        </div>
      </section>

      {/* ============ Modules row ============ */}
      <section>
        <SectionHeader
          eyebrow="Domains"
          title="Open a thread"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ModuleCard href="/music" label="Music" tagline="4 watchlisted releases" stat="12" sub="artists tracked" />
          <ModuleCard href="/film" label="Film" tagline="3 high-signal matches" stat="8" sub="people followed" />
          <ModuleCard href="/places" label="Places" tagline="4 clusters · 10 visits" stat="10" sub="places remembered" />
          <ModuleCard href="/finance" label="Finance" tagline={`Net worth · $${(184320 + 62410 + 14250).toLocaleString()}`} stat={`+${fin.biggestMover?.meta?.change}%`} sub={`${fin.biggestMover?.name} today`} />
        </div>
      </section>

      {/* ============ Because you... ============ */}
      <section>
        <SectionHeader
          eyebrow="Why we surfaced this"
          title="Reasoned, not random"
          description="Every recommendation traces a path through the graph. Tap one to see the chain."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[music, film, place].filter(Boolean).map((r, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow mb-1.5">{r.domain}</div>
                  <div className="font-display text-lg leading-tight">{r.entity.name}</div>
                </div>
                <div className="font-mono text-[10px] tracking-widest text-teal/90 uppercase">
                  {Math.round(r.weight * 100)}%
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{r.reason}</p>
              {r.cta && (
                <button className="mt-4 text-xs font-mono uppercase tracking-[0.15em] text-foreground hover:text-teal transition-colors inline-flex items-center gap-1.5">
                  {r.cta}
                  <ArrowUpRight size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ============ Recent signals ============ */}
      <section>
        <SectionHeader eyebrow="Background signals" title="Quiet movement" />
        <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
          {[
            { time: "2h ago", domain: "Music", text: "Stick Figure announced 3 west-coast tour dates", accent: "teal" },
            { time: "5h ago", domain: "Finance", text: "NVDA up 5.1% — your largest position", accent: "gold" },
            { time: "yesterday", domain: "Film", text: "Tehran S3 entered post-production", accent: "rose" },
            { time: "3 days", domain: "Places", text: "Friend posted from Ericeira — matches your coastal cluster", accent: "gold" },
            { time: "this week", domain: "Music", text: "Kendrick & SZA spotted in studio · pgLang activity", accent: "teal" },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-5 px-5 py-3.5 text-sm">
              <span className="font-mono text-xs text-muted-foreground w-24 shrink-0">{s.time}</span>
              <span className={`eyebrow w-16 shrink-0 text-${s.accent}`}>{s.domain}</span>
              <span className="text-foreground/90">{s.text}</span>
              <ArrowUpRight size={13} className="ml-auto text-muted-foreground" />
            </div>
          ))}
        </div>
      </section>

      <div className="hairline" />
      <footer className="pb-12">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xl text-muted-foreground italic">Life OS</span>
          <span className="eyebrow">a personal command room</span>
        </div>
      </footer>
    </div>
  );
}

function RelevantCard({ tag, icon: Icon, accent, title, date, reason, href }: any) {
  return (
    <Link href={href} data-testid={`card-relevant-${tag.toLowerCase()}`}>
      <div className="group bg-card p-6 cursor-pointer transition-colors hover:bg-card/70 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <span className={`eyebrow text-${accent}`}>{tag}</span>
          <Icon size={14} strokeWidth={1.5} className={`text-${accent}/70`} />
        </div>
        <div className="font-display text-xl leading-tight mb-1.5">{title}</div>
        <div className="font-mono text-[11px] text-muted-foreground tracking-wider">{date}</div>
        <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{reason}</p>
        <div className="mt-auto pt-5 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-foreground/70 group-hover:text-foreground transition-colors">
          Open <ArrowUpRight size={12} />
        </div>
      </div>
    </Link>
  );
}

function ModuleCard({ href, label, tagline, stat, sub }: any) {
  return (
    <Link href={href} data-testid={`card-module-${label.toLowerCase()}`}>
      <div className="group rounded-lg border border-border bg-card p-5 cursor-pointer hover:border-teal/30 transition-colors h-full">
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow mb-2">{label}</div>
            <div className="font-display text-lg leading-tight">{tagline}</div>
          </div>
          <ArrowUpRight size={14} className="text-muted-foreground group-hover:text-teal transition-colors" />
        </div>
        <div className="mt-6 flex items-baseline gap-2">
          <div className="font-display text-2xl tabular text-foreground">{stat}</div>
          <div className="text-xs text-muted-foreground">{sub}</div>
        </div>
      </div>
    </Link>
  );
}

function Trajectory() {
  const rows = [
    { label: "Stick Figure", state: "rising", note: "3 plays/week → 7", value: 92, color: "teal" },
    { label: "Cold-war spy fiction", state: "recurring", note: "thread for 18 months", value: 78, color: "rose" },
    { label: "Coastal cluster", state: "rising", note: "3rd visit this season", value: 71, color: "gold" },
    { label: "NVDA concentration", state: "watch", note: "22% of brokerage", value: 64, color: "gold" },
    { label: "Late-2010s EDM", state: "fading", note: "down from monthly to quarterly", value: 28, color: "foreground" },
  ];
  return (
    <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
      {rows.map((r, i) => (
        <div key={i} className="px-5 py-3.5">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">{r.label}</div>
            <div className={`font-mono text-[10px] uppercase tracking-[0.15em] text-${r.color}`}>{r.state}</div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1 h-[2px] bg-border rounded-full overflow-hidden">
              <div
                className={`h-full bg-${r.color}`}
                style={{ width: `${r.value}%`, transition: "width 600ms cubic-bezier(0.16,1,0.3,1)" }}
              />
            </div>
            <div className="text-[11px] text-muted-foreground font-mono tabular w-10 text-right">{r.value}</div>
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">{r.note}</div>
        </div>
      ))}
    </div>
  );
}
