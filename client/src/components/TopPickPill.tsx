import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useMode } from "./ModeProvider";
import { useLocation as useCity } from "./LocationProvider";

export type TopPickDomain = "stock" | "artist" | "movie" | "show" | "place" | "event";

interface TopPickResp {
  domain: TopPickDomain;
  title?: string;
  subtitle?: string;
  image?: string;
  url?: string;
  why?: string;
  source: string;
  asOf?: string;
  reason?: string;
  // Server-side honesty signal. "high" = anchored to real user/live data.
  // "low"  = editorial fallback. Server only emits low-confidence pills when
  // explicitly requested; this field is here for future opt-ins.
  confidence?: "high" | "low";
}

const DOMAIN_LABEL: Record<TopPickDomain, string> = {
  stock: "TOP STOCK",
  artist: "TOP ARTIST",
  movie: "TOP MOVIE",
  show: "TOP SHOW",
  place: "TOP PLACE",
  event: "TOP EVENT",
};

/**
 * Compact horizontal pill — a single TOP recommendation per domain.
 * Editorial, sparse, dark-first. Sits below its section, never as a hero.
 *
 * Each pill is referential to its category:
 *   - stock / artist / movie / show → anchored to user data in that category
 *   - place / event                 → anchored to the currently selected city
 */
/**
 * `showLowConfidence` (default false): when true, the pill renders editorial
 * fallbacks (the server-side curated nudges) for users with no data in this
 * domain. Default off matches the honesty rule — don't fake a pick if we
 * don't have one.
 */
export function TopPickPill({
  domain,
  className = "",
  compact = false,
  showLowConfidence = false,
}: {
  domain: TopPickDomain;
  className?: string;
  compact?: boolean;
  showLowConfidence?: boolean;
}) {
  const { mode, withMode } = useMode();
  const { city } = useCity();

  // Only place + event are city-scoped — sending city for the others would
  // cause needless cache splits when the user changes locations.
  const cityScoped = domain === "place" || domain === "event";
  const cityForQuery = cityScoped ? city : "";

  const { data, isLoading } = useQuery<TopPickResp>({
    queryKey: ["/api/top-picks", domain, mode, cityForQuery, showLowConfidence],
    queryFn: async () => {
      const params = new URLSearchParams({ domain });
      if (cityScoped && city) params.set("city", city);
      if (showLowConfidence) params.set("showLowConfidence", "1");
      return (await apiRequest("GET", withMode(`/api/top-picks?${params.toString()}`))).json();
    },
  });

  // Skeleton state — soft, no heavy chrome
  if (isLoading) {
    return (
      <div
        data-testid={`pill-top-${domain}-loading`}
        className={`inline-flex items-center gap-2 rounded-full border border-border/40 bg-secondary/20 px-3 py-1.5 ${className}`}
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
          {DOMAIN_LABEL[domain]}
        </span>
        <span className="h-2.5 w-24 rounded-full bg-muted-foreground/15 animate-pulse" />
      </div>
    );
  }

  // Empty / no-data state — don't render a noisy pill, render nothing.
  // Also hide low-confidence editorial fallbacks unless the caller opted in.
  if (!data || data.source === "empty" || !data.title) return null;
  if (data.confidence === "low" && !showLowConfidence) return null;

  const inner = (
    <>
      {data.image ? (
        <img
          src={data.image}
          alt=""
          aria-hidden="true"
          className="h-6 w-6 rounded object-cover shrink-0"
        />
      ) : (
        <Sparkles size={12} className="text-teal shrink-0" />
      )}
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-teal/80 shrink-0">
        {DOMAIN_LABEL[domain]}
      </span>
      <span
        className="text-sm font-medium text-foreground truncate min-w-0 flex-1"
        data-testid={`text-top-${domain}-title`}
        title={data.title}
      >
        {data.title}
      </span>
      {data.why && !compact && (
        <span
          className="hidden xl:inline text-xs text-muted-foreground truncate min-w-0 max-w-[45%] shrink"
          data-testid={`text-top-${domain}-why`}
          title={data.why}
        >
          — {data.why}
        </span>
      )}
      {data.url && (
        <ArrowUpRight
          size={12}
          className="text-muted-foreground/70 group-hover:text-teal transition-colors shrink-0 ml-auto"
        />
      )}
    </>
  );

  const baseCls =
    "group inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 hover:bg-card/70 hover:border-teal/40 backdrop-blur-sm px-3 py-1.5 transition-colors max-w-full";

  if (data.url) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`pill-top-${domain}`}
        className={`${baseCls} ${className}`}
      >
        {inner}
      </a>
    );
  }
  return (
    <div data-testid={`pill-top-${domain}`} className={`${baseCls} ${className}`}>
      {inner}
    </div>
  );
}
