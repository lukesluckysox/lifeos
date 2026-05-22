/**
 * Spotify Web API client.
 *
 * App-wide config: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI from env.
 * Per-user refresh tokens stored in secrets table keyed by userId.
 *
 * For Spotify-as-login OAuth flow:
 *   GET /api/auth/spotify/login  → redirects to Spotify authorize
 *   GET /api/auth/spotify/callback → exchanges code, creates user session
 */
import { storage } from "./storage";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

export type SpotifyConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function getAppConfig(): SpotifyConfig | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID || "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:5000/api/auth/spotify/callback";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

// ── Per-user token cache ──────────────────────────────────────────────────────
const userTokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function getUserRefreshToken(userId: number): Promise<string | null> {
  return (await storage.getSecret(userId, "spotify_refresh_token")) || null;
}

export async function saveUserRefreshToken(userId: number, token: string): Promise<void> {
  await storage.setSecret(userId, "spotify_refresh_token", token);
  userTokenCache.delete(userId); // force re-fetch
}

export async function clearUserRefreshToken(userId: number): Promise<void> {
  await storage.setSecret(userId, "spotify_refresh_token", "");
  userTokenCache.delete(userId);
}

/** Get a fresh access token for a specific user. */
async function getUserAccessToken(userId: number): Promise<string> {
  const cached = userTokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const cfg = getAppConfig();
  const refresh = await getUserRefreshToken(userId);
  if (!cfg || !refresh) throw new Error("Spotify not authorized for this user");

  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Spotify refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  userTokenCache.set(userId, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  if (data.refresh_token && data.refresh_token !== refresh) {
    await saveUserRefreshToken(userId, data.refresh_token);
  }
  return data.access_token;
}

async function userApi<T = any>(userId: number, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const token = await getUserAccessToken(userId);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${API_BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify API ${path} ${res.status}: ${await res.text()}`);
  return await res.json();
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

/** Exchange an authorization code for tokens. */
export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const cfg = getAppConfig();
  if (!cfg) throw new Error("Spotify app config missing");
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

/** Fetch /me profile from Spotify. */
export async function getMe(accessToken: string): Promise<{ id: string; email: string; display_name: string; images: { url: string }[] }> {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Spotify /me failed: ${res.status}`);
  return await res.json();
}

export function buildAuthorizeUrl(state: string): string {
  const cfg = getAppConfig();
  if (!cfg) throw new Error("Spotify app config missing");
  const scopes = [
    "user-read-email",
    "user-read-private",
    "user-read-recently-played",
    "user-top-read",
    "user-read-currently-playing",
    "user-follow-read",
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

/** User-scoped status check. */
export async function userStatus(userId: number): Promise<{ configured: boolean; authorized: boolean }> {
  const cfg = getAppConfig();
  const refresh = await getUserRefreshToken(userId);
  return { configured: !!cfg, authorized: !!(cfg && refresh) };
}

// ── Per-user Spotify API calls ────────────────────────────────────────────────

export async function getRecentlyPlayed(userId: number, limit = 20) {
  const data: any = await userApi(userId, "/me/player/recently-played", { limit });
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

export async function getTopTracks(userId: number, timeRange: "short_term" | "medium_term" | "long_term" = "short_term", limit = 20) {
  const data: any = await userApi(userId, "/me/top/tracks", { time_range: timeRange, limit });
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

export async function getFollowedArtists(userId: number, limit = 50): Promise<Array<{ id: string; name: string; url?: string; image?: string }>> {
  const data: any = await userApi(userId, "/me/following", { type: "artist", limit });
  return (data.artists?.items || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    url: a.external_urls?.spotify,
    image: a.images?.[1]?.url || a.images?.[0]?.url,
  }));
}

export async function getNewReleasesFromFollowed(userId: number, opts: { limit?: number; daysBack?: number } = {}) {
  const limit = opts.limit ?? 20;
  const daysBack = opts.daysBack ?? 60;
  const cutoff = Date.now() - daysBack * 86400000;
  const artists = await getFollowedArtists(userId, 50);
  const subset = artists.slice(0, 20);
  const all: any[] = [];
  for (const a of subset) {
    try {
      const data: any = await userApi(userId, `/artists/${a.id}/albums`, { include_groups: "album,single", limit: 5, market: "US" });
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
    } catch { /* skip */ }
    if (all.length >= limit * 3) break;
  }
  const seen = new Set<string>();
  const sorted = all
    .sort((x, y) => (y.releaseDate || "").localeCompare(x.releaseDate || ""))
    .filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .slice(0, limit);
  return { source: "spotify-new-releases", tracks: sorted, asOf: new Date().toISOString() };
}

// ── Legacy app-level helpers (kept for backward compat within routes that don't have userId) ──

/** App-level status (checks if app creds exist). */
export async function status(): Promise<{ configured: boolean; authorized: boolean }> {
  const cfg = getAppConfig();
  return { configured: !!cfg, authorized: false };
}

// Keep legacy getConfig / saveConfig for the existing /api/spotify/config flow
export async function getConfig() {
  return getAppConfig();
}

export async function saveConfig(c: { clientId: string; clientSecret: string; redirectUri?: string }) {
  // In the new model, Spotify creds come from env — but keep this for legacy/admin use
  console.warn("[spotify] saveConfig called, but credentials are now env-based. Set SPOTIFY_CLIENT_ID/SECRET in environment.");
}

// ── Backward-compat stubs for any residual callers ──────────────────────────
export async function getRefreshToken(): Promise<string | null> { return null; }
export async function saveRefreshToken(_token: string) {}
export async function clearAuth() {}
export function buildAuthorizeUrlLegacy(cfg: SpotifyConfig, state: string): string { return buildAuthorizeUrl(state); }
