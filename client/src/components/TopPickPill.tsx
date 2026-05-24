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
export function TopPickPill({ domain, className = "" }: { domain: TopPickDomain; className?: string }) {
  const { mode, withMode } = useMode();
  const { city } = useCity();

  // Only place + event are city-scoped — sending city for the others would
  // cause needless cache splits when the user changes locations.
  const cityScoped = domain === "place" || domain === "event";
  const cityForQuery = cityScoped ? city : "";

  const { data, isLoading } = useQuery<TopPickResp>({
    queryKey: ["/api/top-picks", domain, mode, cityForQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ domain });
      if (cityScoped && city) params.set("city", city);
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

  // Empty / no-data state — don't render a noisy pill, render nothing
  if (!data || data.source === "empty" || !data.title) return null;

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
        className="text-sm font-medium text-foreground truncate"
        data-testid={`text-top-${domain}-title`}
      >
        {data.title}
      </span>
      {data.why && (
        <span
          className="hidden sm:inline text-xs text-muted-foreground truncate"
          data-testid={`text-top-${domain}-why`}
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
