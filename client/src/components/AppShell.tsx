import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { Sun, Moon, Search, Music, Film, MapPin, LineChart, Home as HomeIcon, Menu, X } from "lucide-react";
import { Wordmark } from "./Logo";
import { useTheme } from "./ThemeProvider";
import { Input } from "@/components/ui/input";

const NAV = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/music", label: "Music", icon: Music },
  { href: "/film", label: "Film", icon: Film },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/finance", label: "Finance", icon: LineChart },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const [location] = useLocation();
  const [navOpen, setNavOpen] = useState(false);

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
                    <Icon size={15} strokeWidth={1.6} className={active ? "text-teal" : ""} />
                    <span className="font-medium tracking-tight">{label}</span>
                    {active && (
                      <span className="ml-auto h-1 w-1 rounded-full bg-teal" />
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto px-5 py-5 border-t border-border">
            <div className="eyebrow mb-2">signed in as</div>
            <div className="text-sm font-medium">Jay Thomas</div>
            <div className="text-xs text-muted-foreground mt-0.5 font-mono">honolulu · synced 2m ago</div>
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

          <main className="flex-1 px-5 sm:px-8 py-8 sm:py-10 max-w-[1400px] w-full">{children}</main>
        </div>
      </div>
    </div>
  );
}


