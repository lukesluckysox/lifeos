import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Music as MusicIcon, X, ExternalLink, RotateCcw, Copy, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// Compute the redirect URI Spotify will accept.
// - On localhost: must use http://127.0.0.1:5000/... (Spotify rejects "localhost")
// - On deployed iframe: server is behind the __PORT_5000__ proxy. We need the absolute URL.
function computeRedirectUri(): string {
  if (typeof window === "undefined") return "";
  const { hostname, port, origin, pathname } = window.location;
  // Localhost dev path — swap to 127.0.0.1 because Spotify only allows IP loopback over HTTP.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://127.0.0.1:${port || "5000"}/api/spotify/callback`;
  }
  // Deployed: API_BASE was substituted at build time. The proxy URL prefix lives in pathname before the iframe.
  // Easiest: try to detect a `__PORT_5000__`-style path by inspecting the apiRequest base via a known global var.
  const apiBase = (window as any).__API_BASE__ || "";
  if (apiBase) return `${apiBase}/api/spotify/callback`;
  // Fallback: just append to origin. The user can paste this verbatim into Spotify's dashboard.
  return `${origin}${pathname.replace(/\/$/, "")}/api/spotify/callback`.replace(/([^:]\/)\/+/g, "$1");
}

interface SpotifyStatus { configured: boolean; authorized: boolean }

export function SpotifyConnect({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const { data: status } = useQuery<SpotifyStatus>({
    queryKey: ["/api/spotify/status"],
    queryFn: async () => (await apiRequest("GET", "/api/spotify/status")).json(),
    refetchOnWindowFocus: true,
  });

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const saveConfig = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/spotify/config", {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        redirectUri: computeRedirectUri(),
      });
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/spotify/status"] }); },
  });

  const beginAuth = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("GET", "/api/spotify/authorize");
      return r.json();
    },
    onSuccess: (data: { url: string }) => {
      if (!data?.url) return;
      const win = window.open(data.url, "spotify-auth", "width=520,height=720");
      // Poll status every 2s for 60s
      const start = Date.now();
      const interval = window.setInterval(() => {
        qc.invalidateQueries({ queryKey: ["/api/spotify/status"] });
        qc.invalidateQueries({ queryKey: ["/api/music-recs"] });
        qc.invalidateQueries({ queryKey: ["/api/concerts-for-you"] });
        qc.invalidateQueries({ queryKey: ["/api/listening-history"] });
        if (win?.closed || Date.now() - start > 60_000) window.clearInterval(interval);
      }, 2000);
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/spotify/disconnect", {})).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/spotify/status"] }); },
  });

  if (status?.authorized) {
    return (
      <div className="rounded-lg border border-teal/30 bg-teal/5 p-4 flex items-center justify-between gap-3" data-testid="banner-spotify-connected">
        <div className="flex items-center gap-2 text-sm text-teal">
          <MusicIcon size={14} /> Spotify connected — recents, top tracks, and new releases are live.
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

  return (
    <div className="rounded-lg border border-gold/30 bg-gold/5 p-5 space-y-4" data-testid="banner-spotify-connect">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-base">Connect your Spotify</div>
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-md">
            The music section needs your real listening data. Create a Spotify dev app, paste the Client ID + Secret below — runs entirely on your server, never leaves Life OS.
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} data-testid="button-spotify-close" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        )}
      </div>

      {!status?.configured && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (clientId.trim() && clientSecret.trim()) saveConfig.mutate(); }}
          className="space-y-2"
          data-testid="form-spotify-config"
        >
          <div className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground space-y-1.5">
            <div>
              Step 1 — register at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-teal underline inline-flex items-center gap-0.5">developer.spotify.com/dashboard <ExternalLink size={9} /></a>
            </div>
            <div>
              Step 2 — add this redirect URI:
            </div>
          </div>
          <CopyableUri uri={computeRedirectUri()} />
          <div className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
            Spotify only accepts HTTPS or <span className="text-foreground">http://127.0.0.1</span> (not “localhost”).
          </div>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            data-testid="input-spotify-client-id"
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-teal/60 font-mono"
          />
          <input
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Client Secret"
            type="password"
            data-testid="input-spotify-client-secret"
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-teal/60 font-mono"
          />
          <button
            type="submit"
            disabled={!clientId.trim() || !clientSecret.trim() || saveConfig.isPending}
            data-testid="button-spotify-save-config"
            className="rounded-md bg-teal/15 border border-teal/30 text-teal px-3 py-1.5 text-xs font-medium hover:bg-teal/25 disabled:opacity-40 transition-colors"
          >
            {saveConfig.isPending ? "Saving…" : "Save credentials"}
          </button>
        </form>
      )}

      {status?.configured && (
        <div className="space-y-2">
          <div className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            Step 3 — authorize Life OS to read your Spotify
          </div>
          <button
            type="button"
            onClick={() => beginAuth.mutate()}
            disabled={beginAuth.isPending}
            data-testid="button-spotify-authorize"
            className="rounded-md bg-teal text-background px-4 py-2 text-sm font-medium hover:bg-teal/90 transition-colors inline-flex items-center gap-1.5"
          >
            <MusicIcon size={13} /> Authorize Spotify
          </button>
        </div>
      )}
    </div>
  );
}

function CopyableUri({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
      <code className="text-[11px] font-mono text-foreground flex-1 truncate select-all" data-testid="text-spotify-redirect-uri" title={uri}>{uri}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(uri);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch { /* swallow */ }
        }}
        data-testid="button-copy-redirect-uri"
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Copy redirect URI"
      >
        {copied ? <Check size={12} className="text-teal" /> : <Copy size={12} />}
      </button>
    </div>
  );
}
