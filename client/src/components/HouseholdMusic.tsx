import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useScope } from "./ScopeProvider";
import { Users, Music as MusicIcon } from "lucide-react";

interface HouseholdTrack {
  id: string;
  name: string;
  artist: string;
  image?: string;
  url?: string;
  pinned?: boolean;
  sharedBy: string | null;
  sharedByUserId: number;
}
interface HouseholdMusicResp {
  inHousehold: boolean;
  section: "recent" | "top";
  tracks: HouseholdTrack[];
}

/**
 * Combined household listening — merges each opted-in member's own live
 * Spotify pull (each person authorizes separately; there's no "shared
 * Spotify account") plus pinned tracks. Renders only when scope is
 * "shared" and the user is in a household. Drop into Music.tsx.
 */
export function HouseholdMusic({ section = "recent" }: { section?: "recent" | "top" }) {
  const { scope, household } = useScope();

  const { data } = useQuery<HouseholdMusicResp>({
    queryKey: ["/api/household/music", section],
    queryFn: async () => (await apiRequest("GET", `/api/household/music?section=${section}`)).json(),
    enabled: scope === "shared" && !!household,
  });

  if (scope !== "shared" || !household || !data?.inHousehold) return null;
  if (!data.tracks?.length) return null;

  return (
    <section className="rounded-xl border border-teal/20 bg-teal/5 p-5" data-testid="section-household-music">
      <div className="flex items-center gap-2 mb-3">
        <Users size={13} className="text-teal" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal">
          Shared · {section === "top" ? "top tracks" : "recently played"}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {data.tracks.slice(0, 12).map((t, i) => (
          <div key={`${t.id}-${i}`} className="space-y-1.5" data-testid={`item-household-track-${i}`}>
            <div className="aspect-square rounded-md bg-muted/40 overflow-hidden border border-border/40 relative">
              {t.image ? (
                <img src={t.image} alt={t.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center">
                  <MusicIcon size={16} className="text-muted-foreground/40" />
                </div>
              )}
              {t.sharedBy && (
                <span className="absolute bottom-1 right-1 rounded-full bg-background/90 border border-border/60 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  {t.sharedBy.split(" ")[0]}
                </span>
              )}
            </div>
            <div className="text-[11px] leading-tight font-medium truncate" title={t.name}>{t.name}</div>
            <div className="text-[10px] text-muted-foreground truncate" title={t.artist}>{t.artist}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
