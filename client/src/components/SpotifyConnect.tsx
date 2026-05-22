import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Music as MusicIcon, RotateCcw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";

interface SpotifyStatus { configured: boolean; authorized: boolean }

export function SpotifyConnect({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: status } = useQuery<SpotifyStatus>({
    queryKey: ["/api/spotify/status"],
    queryFn: async () => (await apiRequest("GET", "/api/spotify/status")).json(),
    refetchOnWindowFocus: true,
  });

  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/spotify/disconnect", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/spotify/status"] });
      qc.invalidateQueries({ queryKey: ["/api/music-recs"] });
      qc.invalidateQueries({ queryKey: ["/api/concerts-for-you"] });
      qc.invalidateQueries({ queryKey: ["/api/listening-history"] });
    },
  });

  const displayName = user?.displayName || user?.email || "your Spotify account";

  if (status?.authorized) {
    return (
      <div className="rounded-lg border border-teal/30 bg-teal/5 p-4 flex items-center justify-between gap-3" data-testid="banner-spotify-connected">
        <div className="flex items-center gap-2 text-sm text-teal">
          <MusicIcon size={14} />
          Connected as {displayName} — recents, top tracks, and new releases are live.
        </div>
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          data-testid="button-spotify-disconnect"
          className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <RotateCcw size={11} /> reset
        </button>
      </div>
    );
  }

  // Not authorized — show reconnect via OAuth
  return (
    <div className="rounded-lg border border-gold/30 bg-gold/5 p-5 space-y-4" data-testid="banner-spotify-connect">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-base">Reconnect Spotify</div>
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-md">
            Your Spotify authorization has expired or was revoked. Re-authorize to restore live music data.
          </div>
        </div>
      </div>
      <a
        href="/api/auth/spotify/login"
        data-testid="button-spotify-reconnect"
        className="inline-flex items-center gap-1.5 rounded-md bg-teal text-background px-4 py-2 text-sm font-medium hover:bg-teal/90 transition-colors"
      >
        <MusicIcon size={13} /> Reconnect Spotify
      </a>
    </div>
  );
}
