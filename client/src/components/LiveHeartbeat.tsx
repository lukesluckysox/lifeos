import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

/**
 * Live data heartbeat for the Finance page.
 *
 * - Shows "last updated Xs ago" with a pulsing teal dot during US market
 *   hours (9:30am – 4:00pm ET, Mon–Fri).
 * - Auto-refetches /api/portfolio every 30s during market hours.
 * - Manual refresh button is always available.
 *
 * Outside market hours, the dot is muted and no auto-refetch fires
 * (avoids hammering Yahoo/Plaid overnight when nothing is changing).
 */
export function LiveHeartbeat() {
  const qc = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const marketOpen = isMarketOpenET();

  // 1-second ticker so "Xs ago" stays fresh
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-refetch every 30s during market hours
  useEffect(() => {
    if (!marketOpen) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] });
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] });
      setLastUpdated(Date.now());
    }, 30_000);
    return () => clearInterval(id);
  }, [marketOpen, qc]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] }),
      qc.invalidateQueries({ queryKey: ["/api/watchlist"] }),
      qc.invalidateQueries({ queryKey: ["/api/movers"] }),
    ]);
    setLastUpdated(Date.now());
    setTimeout(() => setRefreshing(false), 600);
  };

  const ago = Math.floor((Date.now() - lastUpdated) / 1000);
  const agoLabel = formatAgo(ago);

  return (
    <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground" data-testid="live-heartbeat">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          marketOpen ? "bg-teal animate-pulse" : "bg-muted-foreground/40"
        }`}
        title={marketOpen ? "Market open — auto-refresh every 30s" : "Market closed"}
      />
      <span className="font-mono tabular">
        {marketOpen ? "live · " : "closed · "}updated {agoLabel}
      </span>
      <button
        type="button"
        onClick={handleManualRefresh}
        disabled={refreshing}
        data-testid="button-refresh-heartbeat"
        className="ml-1 p-1 rounded hover:bg-accent/60 transition-colors disabled:opacity-50"
        aria-label="Refresh now"
      >
        <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
      </button>
    </div>
  );
}

function formatAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/**
 * US market hours: 9:30am – 4:00pm Eastern, Mon–Fri.
 * Ignores holidays (good enough for a personal app).
 */
function isMarketOpenET(): boolean {
  const now = new Date();
  // Get Eastern time using Intl
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false; // Sun/Sat
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
