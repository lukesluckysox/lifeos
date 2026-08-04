import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useScope } from "./ScopeProvider";
import { useLocation as useCity } from "./LocationProvider";
import { Users, Calendar as CalIcon } from "lucide-react";

interface HouseholdConcert {
  artist: string;
  name: string;
  venue: string;
  city: string;
  date: string;
  url?: string;
  basedOn?: string;
}
interface HouseholdConcertsResp {
  inHousehold: boolean;
  source: string;
  city: string;
  concerts: HouseholdConcert[];
}

function formatDate(iso?: string) {
  if (!iso) return "TBA";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso || "TBA";
  }
}

/**
 * Combined household concert matches — merges each opted-in member's
 * followed/recent/top Spotify artists and pinned artists before
 * re-running the Ticketmaster match, so a show either partner would like
 * surfaces once. Renders only when scope is "shared" and the user is in
 * a household. Drop into Events.tsx.
 */
export function HouseholdConcerts() {
  const { scope, household } = useScope();
  const { city } = useCity();

  const { data } = useQuery<HouseholdConcertsResp>({
    queryKey: ["/api/household/concerts-for-you", city],
    queryFn: async () => (await apiRequest("GET", `/api/household/concerts-for-you?city=${encodeURIComponent(city)}`)).json(),
    enabled: scope === "shared" && !!household,
  });

  if (scope !== "shared" || !household || !data?.inHousehold) return null;
  if (!data.concerts?.length) return null;

  return (
    <section className="rounded-xl border border-teal/20 bg-teal/5 p-5" data-testid="section-household-concerts">
      <div className="flex items-center gap-2 mb-3">
        <Users size={13} className="text-teal" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal">
          Shared · concerts for you two in {data.city}
        </span>
      </div>
      <ul className="space-y-2.5">
        {data.concerts.slice(0, 8).map((c, i) => (
          <li
            key={`${c.artist}-${c.date}-${i}`}
            className="text-sm leading-snug flex items-start gap-3"
            data-testid={`item-household-concert-${i}`}
          >
            <CalIcon size={12} className="text-teal mt-1 shrink-0" />
            <span className="font-mono text-[10px] tabular text-muted-foreground shrink-0 w-16 mt-0.5">
              {formatDate(c.date)}
            </span>
            <span className="flex-1 min-w-0">
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium truncate block hover:text-teal transition-colors"
                title={c.name || c.artist}
              >
                {c.name || c.artist}
              </a>
              <span className="text-xs text-muted-foreground truncate block">
                {c.venue}{c.basedOn ? ` · ${c.basedOn}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
