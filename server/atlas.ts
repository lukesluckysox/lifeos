/**
 * Atlas (sibling app) read-only client.
 *
 * Atlas owns the canonical "paths" data — places you've logged with photos,
 * weather, moon phase, etc. Radius reads through here to surface them in the
 * Places page. We never write to Atlas.
 *
 * Per-user model: each Radius user links their Atlas account via the
 * /connect/radius consent flow on Atlas. The link (atlasUserId) is stored
 * in the atlas_links table. This module fetches paths for a given
 * atlasUserId — there's no global "the" user anymore.
 *
 * Required env (server-to-server):
 *   ATLAS_BASE_URL    — e.g. https://traces.up.railway.app
 *   ATLAS_FEED_TOKEN  — must match Atlas's LIFE_OS_FEED_TOKEN
 */

export type AtlasPath = {
  id: string;
  type: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  date: string | null;
  note: string | null;
  photoUrl: string | null;
  weatherTemp: number | null;
  weatherLabel: string | null;
  moonPhase: number | null;
  shareSlug: string | null;
  createdAt: string;
};

type CacheEntry = { paths: AtlasPath[]; at: number };
const CACHE_TTL_MS = 60_000;
// Keyed by atlasUserId so two Radius users linked to different Atlas
// accounts don't cross-contaminate.
const cache = new Map<string, CacheEntry>();

export function atlasServerConfigured(): boolean {
  return Boolean(process.env.ATLAS_BASE_URL && process.env.ATLAS_FEED_TOKEN);
}

export function atlasBaseUrl(): string {
  return (process.env.ATLAS_BASE_URL || "").replace(/\/$/, "");
}

/**
 * Fetch a specific Atlas user's paths. Returns [] if the server isn't
 * configured or the fetch fails — surfacing failure as an empty section is
 * better than crashing the Places page.
 */
export async function fetchAtlasPathsForUser(
  atlasUserId: string,
  opts?: { force?: boolean }
): Promise<{
  paths: AtlasPath[];
  source: "atlas" | "cache" | "unconfigured" | "error";
}> {
  if (!atlasServerConfigured()) return { paths: [], source: "unconfigured" };
  if (!atlasUserId) return { paths: [], source: "unconfigured" };

  const now = Date.now();
  const hit = cache.get(atlasUserId);
  if (!opts?.force && hit && now - hit.at < CACHE_TTL_MS) {
    return { paths: hit.paths, source: "cache" };
  }

  const url = `${atlasBaseUrl()}/api/feed?userId=${encodeURIComponent(
    atlasUserId
  )}&take=500`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.ATLAS_FEED_TOKEN}` },
    });
    if (!res.ok) {
      console.warn(`[atlas] feed responded ${res.status} for ${atlasUserId}`);
      return { paths: hit?.paths ?? [], source: "error" };
    }
    const json = (await res.json()) as { paths?: AtlasPath[] };
    const paths = Array.isArray(json.paths) ? json.paths : [];
    cache.set(atlasUserId, { paths, at: now });
    return { paths, source: "atlas" };
  } catch (err) {
    console.warn(`[atlas] feed fetch failed for ${atlasUserId}`, err);
    return { paths: hit?.paths ?? [], source: "error" };
  }
}

/**
 * Exchange a one-time auth code (from the Atlas consent flow) for the
 * underlying Atlas userId. Server-to-server, authenticated with our shared
 * feed token. Returns null on any failure.
 */
export async function exchangeAtlasCode(code: string): Promise<{
  atlasUserId: string;
  atlasUsername: string | null;
  atlasName: string | null;
} | null> {
  if (!atlasServerConfigured()) return null;

  try {
    const res = await fetch(
      `${atlasBaseUrl()}/api/connect/radius/exchange`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.ATLAS_FEED_TOKEN}`,
        },
        body: JSON.stringify({ code }),
      }
    );
    if (!res.ok) {
      console.warn(`[atlas] exchange responded ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      userId?: string;
      username?: string | null;
      name?: string | null;
    };
    if (!json.userId) return null;
    return {
      atlasUserId: json.userId,
      atlasUsername: json.username ?? null,
      atlasName: json.name ?? null,
    };
  } catch (err) {
    console.warn(`[atlas] exchange failed`, err);
    return null;
  }
}

/** Build an Atlas share-card URL for a path. */
export function atlasShareUrl(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return `${atlasBaseUrl()}/s/path/${slug}`;
}

/**
 * Invalidate the cache for a given Atlas user. Call after disconnect or
 * when forcing a fresh fetch.
 */
export function invalidateAtlasCache(atlasUserId: string) {
  cache.delete(atlasUserId);
}
