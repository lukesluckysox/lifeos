/**
 * Spotify Web API client backed by a stored refresh token.
 *
 * Setup: user creates a Spotify dev app, sets redirect URI to
 *   http://localhost:5000/api/spotify/callback
 * and provides Client ID + Client Secret as env vars or via /api/spotify/config.
 *
 * Tokens (refresh) and config live in the `secrets` table so they survive restarts and deploys.
 */
import { storage } from "./storage";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

// In-memory cache of the current access token (refresh tokens are long-lived).
let cachedAccess: { token: string; expiresAt: number } | null = null;

export type SpotifyConfig = { clientId: string; clientSecret: string; redirectUri: string };

export async function getConfig(): Promise<SpotifyConfig | null> {
  const clientId = (await storage.getSecret("spotify_client_id")) || process.env.SPOTIFY_CLIENT_ID || "";
  const clientSecret = (await storage.getSecret("spotify_client_secret")) || process.env.SPOTIFY_CLIENT_SECRET || "";
  const redirectUri = (await storage.getSecret("spotify_redirect_uri")) || process.env.SPOTIFY_REDIRECT_URI || "http://localhost:5000/api/spotify/callback";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

export async function saveConfig(c: { clientId: string; clientSecret: string; redirectUri?: string }) {
  await storage.setSecret("spotify_client_id", c.clientId);
  await storage.setSecret("spotify_client_secret", c.clientSecret);
  if (c.redirectUri) await storage.setSecret("spotify_redirect_uri", c.redirectUri);
}

export async function getRefreshToken(): Promise<string | null> {
  return (await storage.getSecret("spotify_refresh_token")) || null;
}

export async function saveRefreshToken(token: string) {
  await storage.setSecret("spotify_refresh_token", token);
  cachedAccess = null; // force refresh next call
}

export async function clearAuth() {
  await storage.setSecret("spotify_refresh_token", "");
  cachedAccess = null;
}

/** Exchange an authorization code for a refresh+access token pair. */
export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const cfg = await getConfig();
  if (!cfg) throw new Error("Spotify config missing");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  });
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

/** Ensure we have a fresh access token, refreshing if needed. */
async function getAccessToken(): Promise<string> {
  if (cachedAccess && cachedAccess.expiresAt > Date.now() + 30_000) return cachedAccess.token;
  const cfg = await getConfig();
  const refresh = await getRefreshToken();
  if (!cfg || !refresh) throw new Error("Spotify not authorized");
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Spotify refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedAccess = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  // Spotify may return a new refresh_token; persist if it does
  if (data.refresh_token && data.refresh_token !== refresh) {
    await saveRefreshToken(data.refresh_token);
  }
  return cachedAccess.token;
}

async function api<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const token = await getAccessToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${API_BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify API ${path} ${res.status}: ${await res.text()}`);
  return await res.json();
}

/* ------------ public endpoints used by /api/spotify/* ------------ */

export async function getRecentlyPlayed(limit = 20) {
  // GET /me/player/recently-played
  const data: any = await api("/me/player/recently-played", { limit });
  const tracks = (data.items || []).map((it: any) => ({
    id: it.track.id,
    name: it.track.name,
    artist: (it.track.artists || []).map((a: any) => a.name).join(", "),
    album: it.track.album?.name,
    image: it.track.album?.images?.[1]?.url || it.track.album?.images?.[0]?.url,
    playedAt: it.played_at,
    url: it.track.external_urls?.spotify,
    releaseDate: it.track.album?.release_date,
  }));
  return { source: "spotify-recently-played", tracks, asOf: new Date().toISOString() };
}

export async function getTopTracks(timeRange: "short_term" | "medium_term" | "long_term" = "short_term", limit = 20) {
  // GET /me/top/tracks (short_term = ~4 weeks)
  const data: any = await api("/me/top/tracks", { time_range: timeRange, limit });
  const tracks = (data.items || []).map((it: any) => ({
    id: it.id,
    name: it.name,
    artist: (it.artists || []).map((a: any) => a.name).join(", "),
    album: it.album?.name,
    image: it.album?.images?.[1]?.url || it.album?.images?.[0]?.url,
    popularity: it.popularity,
    url: it.external_urls?.spotify,
    releaseDate: it.album?.release_date,
  }));
  return { source: "spotify-top-tracks", timeRange, tracks, asOf: new Date().toISOString() };
}

export async function getFollowedArtists(limit = 50): Promise<Array<{ id: string; name: string; url?: string; image?: string }>> {
  // GET /me/following?type=artist
  const data: any = await api("/me/following", { type: "artist", limit });
  return (data.artists?.items || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    url: a.external_urls?.spotify,
    image: a.images?.[1]?.url || a.images?.[0]?.url,
  }));
}

export async function getNewReleasesFromFollowed(opts: { limit?: number; daysBack?: number } = {}) {
  const limit = opts.limit ?? 20;
  const daysBack = opts.daysBack ?? 60;
  const cutoff = Date.now() - daysBack * 86400000;
  const artists = await getFollowedArtists(50);
  // Spotify's "new releases" endpoint is global; for "new releases from your artists" we need per-artist albums.
  // Throttle: hit at most 20 artists.
  const subset = artists.slice(0, 20);
  const all: any[] = [];
  for (const a of subset) {
    try {
      const data: any = await api(`/artists/${a.id}/albums`, { include_groups: "album,single", limit: 5, market: "US" });
      for (const al of (data.items || [])) {
        const ts = Date.parse(al.release_date || "");
        if (Number.isFinite(ts) && ts >= cutoff) {
          all.push({
            id: al.id,
            name: al.name,
            artist: (al.artists || []).map((x: any) => x.name).join(", ") || a.name,
            album: al.name,
            image: al.images?.[1]?.url || al.images?.[0]?.url,
            releaseDate: al.release_date,
            albumType: al.album_type,
            url: al.external_urls?.spotify,
          });
        }
      }
    } catch {
      // skip on failure
    }
    if (all.length >= limit * 3) break;
  }
  // sort newest first, dedupe by id, cap
  const seen = new Set<string>();
  const sorted = all
    .sort((x, y) => (y.releaseDate || "").localeCompare(x.releaseDate || ""))
    .filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .slice(0, limit);
  return { source: "spotify-new-releases", tracks: sorted, asOf: new Date().toISOString() };
}

export async function status(): Promise<{ configured: boolean; authorized: boolean }> {
  const cfg = await getConfig();
  const refresh = await getRefreshToken();
  return { configured: !!cfg, authorized: !!(cfg && refresh) };
}

export function buildAuthorizeUrl(cfg: SpotifyConfig, state: string): string {
  const scopes = [
    "user-read-recently-played",
    "user-top-read",
    "user-follow-read",
    "user-read-private",
    "user-library-read",
  ];
  const qs = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    scope: scopes.join(" "),
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `https://accounts.spotify.com/authorize?${qs}`;
}
