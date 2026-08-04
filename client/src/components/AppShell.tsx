import { ReactNode, useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Sun, Moon, Search, Music, MapPin, LineChart, Home as HomeIcon, Menu, X, Tv, Calendar, BellOff, Bell, Bookmark, RefreshCw, Settings, Loader2 } from "lucide-react";
import { Wordmark } from "./Logo";
import { useTheme } from "./ThemeProvider";
import { useMode } from "./ModeProvider";
import { useQuietMode, QUIET_DOMAIN_LABELS, type QuietDomain } from "./QuietModeProvider";
import { useLocation as useCity } from "./LocationProvider";
import { HouseholdScopePill } from "./HouseholdScopePill";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/* ─────────────────────────────────────────────────────────────────────── */
/* CitySearch — real geocoded city autocomplete */
/* ─────────────────────────────────────────────────────────────────────── */

interface CityHit {
  name: string;
  region: string;
  country: string;
  cc: string;
  display: string;
  lat?: number;
  lon?: number;
}

function CitySearch({
  initial,
  onPick,
  current,
}: {
  initial: string;
  onPick: (city: string) => void;
  current: string;
}) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<CityHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const seq = useRef(0);

  // Debounced fetch — 250ms after last keystroke. Aborts stale requests.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const mySeq = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiRequest("GET", `/api/places/city-search?q=${encodeURIComponent(term)}`);
        const data: { items?: CityHit[] } = await res.json();
        // Drop result if a newer request started since.
        if (mySeq !== seq.current) return;
        setHits(Array.isArray(data.items) ? data.items : []);
        setActiveIdx(0);
      } catch {
        if (mySeq === seq.current) setHits([]);
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const commit = (hit?: CityHit) => {
    if (hit) {
      onPick(hit.name);
      return;
    }
    // Free-text fallback — if there's a typed value and no hit selected, accept as-is.
    const term = q.trim();
    if (term) onPick(term);
  };

  return (
    <div>
      <div className="eyebrow mb-2">Set city</div>
      <div className="relative">
        <Input
          data-testid="input-location-city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              commit(hits[activeIdx]);
            }
          }}
          placeholder="Search any city…"
          autoFocus
          className="h-8 text-sm pr-7"
        />
        {loading && (
          <Loader2
            size={12}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin"
            data-testid="icon-city-loading"
          />
        )}
      </div>

      {/* Results list */}
      {hits.length > 0 && (
        <ul
          className="mt-2 max-h-60 overflow-y-auto rounded border border-border bg-popover divide-y divide-border/40"
          data-testid="list-city-results"
        >
          {hits.map((h, i) => (
            <li key={`${h.name}-${h.region}-${h.country}`}>
              <button
                type="button"
                onClick={() => commit(h)}
                onMouseEnter={() => setActiveIdx(i)}
                data-testid={`option-city-${h.name.toLowerCase().replace(/\s+/g, "-")}-${i}`}
                className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center justify-between gap-2 transition ${
                  i === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                }`}
              >
                <span className="truncate">
                  <span className="text-foreground">{h.name}</span>
                  {h.region && <span className="text-muted-foreground">, {h.region}</span>}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  {h.cc || h.country.slice(0, 3).toUpperCase()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Empty result state — only when the user typed something but nothing matched. */}
      {!loading && q.trim().length >= 2 && hits.length === 0 && (
        <div
          className="mt-2 rounded border border-border/60 bg-card/30 px-2.5 py-2 text-[11px] text-muted-foreground"
          data-testid="text-city-no-results"
        >
          No matches. Press Enter to use "{q.trim()}" anyway.
        </div>
      )}

      {/* Pinned quick-picks — only shown when input is empty, so they don't crowd the search. */}
      {q.trim().length < 2 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Honolulu", "Los Angeles", "New York", "San Francisco", "Tokyo"].map((c) => (
            <button
              key={c}
              type="button"
              data-testid={`button-location-quick-${c.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => onPick(c)}
              className={`text-[11px] rounded-full border px-2 py-1 transition ${current === c ? "border-blue/40 bg-blue/10 text-blue" : "border-border hover:bg-accent"}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/finance", label: "Finance", icon: LineChart },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/events", label: "Events", icon: Calendar },
  { href: "/music", label: "Music", icon: Music },
  { href: "/watch", label: "Watch", icon: Tv },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/settings", label: "Settings", icon: Settings },
];

const QUIET_DOMAINS: QuietDomain[] = ["music", "finance", "film", "watch", "events", "places", "food", "concerts"];

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const { mode, toggle: toggleMode } = useMode();
  const { muted, toggle: toggleQuiet, reset: resetQuiet } = useQuietMode();
  const { city, setCity } = useCity();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState(city);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Invalidate triggers a refetch for any active query on the current page.
      // refetchType:"active" keeps the spinner tied to what's actually visible.
      await queryClient.invalidateQueries({ refetchType: "active" });
    } finally {
      // Hold the spin briefly so it's perceptible even on instant cache hits
      setTimeout(() => setRefreshing(false), 350);
    }
  };

  const handleModeToggle = () => {
    toggleMode();
    // Invalidate all queries so they refetch with the new mode
    queryClient.invalidateQueries();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* atmosphere */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 12%, hsl(var(--accent-teal)) 0%, transparent 40%), radial-gradient(circle at 82% 78%, hsl(var(--accent-gold)) 0%, transparent 45%)",
        }}
      />

      <div className="relative z-10 lg:grid min-h-screen lg:grid-cols-[220px_1fr]">
        {/* Sidebar backdrop on mobile */}
        {navOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-background/70 backdrop-blur-sm z-30"
            onClick={() => setNavOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`border-r border-border bg-sidebar lg:bg-sidebar/40 backdrop-blur-sm flex flex-col fixed lg:static inset-y-0 left-0 w-[240px] z-40 transition-transform lg:transition-none ${navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
          <div className="px-5 py-6 border-b border-border">
            <Link href="/" data-testid="link-home-logo">
              <div className="cursor-pointer">
                <Wordmark />
              </div>
            </Link>
          </div>

          <nav className="px-3 py-4 flex flex-col gap-0.5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = location === href || (href !== "/" && location.startsWith(href));
              return (
                <Link key={href} href={href} data-testid={`link-${label.toLowerCase()}`}>
                  <div
                    onClick={() => setNavOpen(false)}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <Icon size={15} strokeWidth={1.6} className={active ? "text-blue" : ""} />
                    <span className="font-medium tracking-tight">{label}</span>
                    {active && (
                      <span className="ml-auto h-1 w-1 rounded-full bg-teal" />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Cmd+K hint */}
          <button
            type="button"
            data-testid="button-open-cmdk"
            onClick={() => {
              // Synthesize a Cmd+K keydown so the global listener picks it up.
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
            }}
            className="mx-3 mt-2 flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border/60 hover:border-border hover:bg-accent/40 transition-colors text-left"
          >
            <span className="text-xs text-muted-foreground">Quick search</span>
            <kbd className="font-mono text-[10px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">⌘K</kbd>
          </button>

          <div className="mt-auto px-5 py-5 border-t border-border">
            <div className="eyebrow mb-2">signed in as</div>
            <div className="text-sm font-medium">Jay Thomas</div>
            <div className="text-xs text-muted-foreground mt-0.5 font-mono">honolulu · synced 2m ago</div>
            <div className="mt-3 flex items-center gap-2">
              <Link href="/whats-new">
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-blue/10 hover:bg-blue/20 text-blue px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] cursor-pointer transition-colors"
                  data-testid="badge-version"
                >
                  <span className="w-1 h-1 rounded-full bg-blue animate-pulse" />
                  v0.4
                </span>
              </Link>
              <Link href="/whats-new">
                <span
                  className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60 hover:text-blue transition-colors cursor-pointer"
                  data-testid="link-whats-new-hint"
                >
                  what's new
                </span>
              </Link>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex flex-col min-w-0">
          {/* Top utility bar */}
          <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
            <div className="flex items-center gap-3 px-5 sm:px-8 py-3.5">
              <button
                data-testid="button-menu"
                onClick={() => setNavOpen((o) => !o)}
                className="lg:hidden h-8 w-8 grid place-items-center rounded-md border border-border hover:bg-accent"
                aria-label="Open navigation"
              >
                {navOpen ? <X size={14} /> : <Menu size={14} />}
              </button>
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-testid="input-command"
                  placeholder="Search the graph…"
                  className="pl-9 h-9 text-sm bg-secondary/40 border-border focus-visible:ring-1 focus-visible:ring-teal"
                />
              </div>
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden md:inline eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span>
                {/* Shared location pill */}
                <div className="relative">
                  <button
                    data-testid="button-location"
                    onClick={() => { setCityDraft(city); setLocOpen(o => !o); }}
                    aria-label="Change city"
                    title={`Location — used across Food, Concerts, and Places. Currently: ${city}`}
                    className="h-8 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 hover:bg-accent px-3 transition-colors"
                  >
                    <MapPin size={12} className="text-blue" />
                    <span className="font-mono text-[11px] uppercase tracking-wider">{city}</span>
                  </button>
                  {locOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setLocOpen(false)} />
                      <div className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg z-40 p-3" data-testid="menu-location">
                        <CitySearch
                          initial={cityDraft}
                          current={city}
                          onPick={(c) => {
                            setCity(c);
                            setLocOpen(false);
                            queryClient.invalidateQueries();
                            // Fire-and-forget: warm the travel-guide cache in the
                            // background so Places loads fast when the user gets there.
                            apiRequest("POST", "/api/travel-guide/prefetch", { city: c }).catch(() => {});
                          }}
                        />
                        <div className="mt-3 pt-3 border-t border-border/40 text-[10px] text-muted-foreground italic">
                          Shared across Food, Concerts, and Places.
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {/* Me / Shared household scope pill */}
                <HouseholdScopePill />
                {/* Live / Demo pill toggle */}
                <button
                  data-testid="button-mode-toggle"
                  onClick={handleModeToggle}
                  aria-label={`Switch to ${mode === "live" ? "demo" : "live"} mode`}
                  className="group h-8 inline-flex items-center rounded-full border border-border bg-secondary/40 hover:bg-accent transition-colors p-0.5 font-mono text-[10px] uppercase tracking-wider"
                  title={mode === "live" ? "Showing your real data. Click to switch to sample data." : "Showing sample data — safe to share. Click to switch back to your data."}
                >
                  <span className={`px-2.5 py-1 rounded-full transition-colors ${mode === "live" ? "bg-blue text-white" : "text-muted-foreground"}`}>
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${mode === "live" ? "bg-background animate-pulse" : "bg-muted-foreground"}`} />
                      Live
                    </span>
                  </span>
                  <span className={`px-2.5 py-1 rounded-full transition-colors ${mode === "demo" ? "bg-gold text-background" : "text-muted-foreground"}`}>
                    Demo
                  </span>
                </button>
                {/* Quiet mode trigger */}
                <div className="relative">
                  <button
                    data-testid="button-quiet-mode"
                    onClick={() => setQuietOpen(o => !o)}
                    aria-label="Quiet mode"
                    title={muted.size > 0 ? `${muted.size} muted on home` : "Quiet mode — mute domains on home"}
                    className={`h-8 w-8 grid place-items-center rounded-md border transition-colors ${muted.size > 0 ? "border-gold text-gold bg-gold/10" : "border-border hover:bg-accent"}`}
                  >
                    {muted.size > 0 ? <BellOff size={14} /> : <Bell size={14} />}
                  </button>
                  {quietOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setQuietOpen(false)} />
                      <div className="absolute right-0 mt-2 w-60 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg z-40 p-3" data-testid="menu-quiet-mode">
                        <div className="eyebrow mb-2 flex items-center justify-between">
                          <span>Quiet on home</span>
                          {muted.size > 0 && (
                            <button
                              data-testid="button-quiet-reset"
                              onClick={() => { resetQuiet(); }}
                              className="font-mono text-[10px] uppercase tracking-wider text-blue hover:underline"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {QUIET_DOMAINS.map(d => {
                            const m = muted.has(d);
                            return (
                              <button
                                key={d}
                                data-testid={`button-quiet-${d}`}
                                onClick={() => toggleQuiet(d)}
                                className={`text-xs rounded-md border px-2 py-1.5 transition ${m ? "border-gold bg-gold/10 text-gold" : "border-border hover:bg-accent"}`}
                              >
                                {QUIET_DOMAIN_LABELS[d]}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-3 pt-3 border-t border-border/40 text-[10px] text-muted-foreground italic">
                          Session-only. Cleared on refresh.
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <button
                  data-testid="button-refresh"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  aria-label="Refresh data on this page"
                  title="Refresh data on this page"
                  className="h-8 w-8 grid place-items-center rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-60"
                >
                  <RefreshCw size={14} className={refreshing ? "animate-spin text-blue" : ""} />
                </button>
                <button
                  data-testid="button-theme-toggle"
                  onClick={toggle}
                  aria-label="Toggle theme"
                  className="h-8 w-8 grid place-items-center rounded-md border border-border hover:bg-accent transition-colors"
                >
                  {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-5 sm:px-8 py-8 sm:py-10 pb-24 max-w-[1400px] w-full">{children}</main>
        </div>
      </div>
    </div>
  );
}
