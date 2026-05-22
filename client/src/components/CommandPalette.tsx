import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Home as HomeIcon,
  LineChart,
  MapPin,
  Calendar,
  Music as MusicIcon,
  Tv,
  Bookmark,
  Plus,
  TrendingUp,
  Building2,
  LogOut,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface Holding { id: number; symbol: string; name: string; kind: string }
interface WatchItem { id: number; symbol: string; name: string | null }
interface PlaidItemRow { id: number; institutionName: string }

const NAV_TARGETS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/finance", label: "Finance", icon: LineChart },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/events", label: "Events", icon: Calendar },
  { href: "/music", label: "Music", icon: MusicIcon },
  { href: "/watch", label: "Watch", icon: Tv },
  { href: "/saved", label: "Saved", icon: Bookmark },
];

const QUICK_ACTIONS = [
  { id: "add-holding", label: "Add a holding", icon: Plus, target: "/finance" },
  { id: "connect-brokerage", label: "Connect a brokerage", icon: Building2, target: "/finance" },
  { id: "view-watchlist", label: "View watchlist", icon: TrendingUp, target: "/finance#watchlist" },
  { id: "ask-lumen", label: "Ask Lumen (AI insights)", icon: Sparkles, target: "ai" },
];

/**
 * Global Cmd+K / Ctrl+K command palette.
 *
 * Searches across:
 *   - Nav pages (Home, Finance, Music, etc.)
 *   - Quick actions (add holding, connect brokerage, ask AI)
 *   - User's holdings (jump to Finance, focus that symbol)
 *   - User's watchlist
 *   - Connected brokerages
 *   - Logout
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();

  // Keyboard shortcut: Cmd+K (mac) or Ctrl+K (win/linux)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Pull lightweight context: holdings, watchlist, brokerages
  // (only when palette is open, to avoid eager network spam)
  const { data: holdings = [] } = useQuery<Holding[]>({
    queryKey: ["/api/holdings"],
    queryFn: async () => (await apiRequest("GET", "/api/holdings")).json(),
    enabled: open && !!user,
  });
  const { data: watchlist = [] } = useQuery<WatchItem[]>({
    queryKey: ["/api/watchlist"],
    queryFn: async () => (await apiRequest("GET", "/api/watchlist")).json(),
    enabled: open && !!user,
  });
  const { data: plaidItems = [] } = useQuery<PlaidItemRow[]>({
    queryKey: ["/api/plaid/items"],
    queryFn: async () => (await apiRequest("GET", "/api/plaid/items")).json(),
    enabled: open && !!user,
  });

  const handleSelect = (action: () => void) => {
    setOpen(false);
    // Small delay so the dialog close animation completes before nav
    setTimeout(action, 50);
  };

  const goto = (href: string) => handleSelect(() => {
    if (href === "ai") {
      // Trigger the AskLumen panel via a custom event
      window.dispatchEvent(new CustomEvent("open-ask-lumen"));
      return;
    }
    // Wouter hash routing: prefix with #
    if (href.startsWith("/")) {
      window.location.hash = href;
    } else {
      setLocation(href);
    }
  });

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search anything — pages, holdings, actions…" data-testid="input-cmdk" />
      <CommandList>
        <CommandEmpty>No matches. Try a stock ticker or page name.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          {QUICK_ACTIONS.map(a => (
            <CommandItem
              key={a.id}
              onSelect={() => goto(a.target)}
              data-testid={`cmdk-action-${a.id}`}
            >
              <a.icon size={14} className="mr-2 text-muted-foreground" />
              <span>{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to">
          {NAV_TARGETS.map(n => (
            <CommandItem
              key={n.href}
              onSelect={() => goto(n.href)}
              data-testid={`cmdk-nav-${n.label.toLowerCase()}`}
            >
              <n.icon size={14} className="mr-2 text-muted-foreground" />
              <span>{n.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {holdings.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Your holdings">
              {holdings.slice(0, 12).map(h => (
                <CommandItem
                  key={`h-${h.id}`}
                  onSelect={() => goto(`/finance`)}
                  data-testid={`cmdk-holding-${h.symbol}`}
                  value={`${h.symbol} ${h.name}`}
                >
                  <span className="font-mono text-foreground w-14 text-xs">{h.symbol}</span>
                  <span className="text-xs text-muted-foreground truncate">{h.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {watchlist.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Watchlist">
              {watchlist.slice(0, 8).map(w => (
                <CommandItem
                  key={`w-${w.id}`}
                  onSelect={() => goto(`/finance`)}
                  data-testid={`cmdk-watch-${w.symbol}`}
                  value={`${w.symbol} ${w.name || ""}`}
                >
                  <TrendingUp size={12} className="mr-2 text-muted-foreground" />
                  <span className="font-mono text-foreground w-14 text-xs">{w.symbol}</span>
                  <span className="text-xs text-muted-foreground truncate">{w.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {plaidItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Brokerages">
              {plaidItems.map(p => (
                <CommandItem
                  key={`p-${p.id}`}
                  onSelect={() => goto(`/finance`)}
                  data-testid={`cmdk-brokerage-${p.id}`}
                  value={p.institutionName}
                >
                  <Building2 size={12} className="mr-2 text-teal/70" />
                  <span className="text-xs text-foreground">{p.institutionName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {user && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Account">
              <CommandItem
                onSelect={() => handleSelect(() => logout())}
                data-testid="cmdk-logout"
              >
                <LogOut size={14} className="mr-2 text-muted-foreground" />
                <span>Sign out</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
