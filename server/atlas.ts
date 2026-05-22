/**
 * Atlas (sibling app) read-only client.
 *
 * Atlas owns the canonical "paths" data — places you've logged with photos,
 * weather, moon phase, etc. Life OS reads through here to surface them in
 * the Places page. We never write to Atlas.
 *
 * Required env:
 *   ATLAS_BASE_URL         — e.g. https://atlas-production-df1b.up.railway.app
 *   ATLAS_FEED_TOKEN       — must match Atlas's LIFE_OS_FEED_TOKEN
 *   ATLAS_USER_ID          — the Atlas user whose paths to surface (single-user
 *                            setup for now — fine since Life OS is also single
 *                            tenant per session)
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
let cache: CacheEntry | null = null;

export function atlasConfigured(): boolean {
  return Boolean(
    process.env.ATLAS_BASE_URL &&
      process.env.ATLAS_FEED_TOKEN &&
      process.env.ATLAS_USER_ID
  );
}

export function atlasBaseUrl(): string {
  return (process.env.ATLAS_BASE_URL || "").replace(/\/$/, "");
}

/**
 * Fetch the user's paths from Atlas. Returns [] if not configured or on
 * fetch error — surfacing the failure to the user as an empty section is
 * better than crashing the whole Places page.
 */
export async function fetchAtlasPaths(opts?: { force?: boolean }): Promise<{
  paths: AtlasPath[];
  source: "atlas" | "cache" | "unconfigured" | "error";
}> {
  if (!atlasConfigured()) return { paths: [], source: "unconfigured" };

  const now = Date.now();
  if (!opts?.force && cache && now - cache.at < CACHE_TTL_MS) {
    return { paths: cache.paths, source: "cache" };
  }

  const url = `${atlasBaseUrl()}/api/feed?userId=${encodeURIComponent(
    process.env.ATLAS_USER_ID!
  )}&take=200`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.ATLAS_FEED_TOKEN}`,
      },
    });
    if (!res.ok) {
      console.warn(`[atlas] feed responded ${res.status}`);
      return { paths: cache?.paths ?? [], source: "error" };
    }
    const json = (await res.json()) as { paths?: AtlasPath[] };
    const paths = Array.isArray(json.paths) ? json.paths : [];
    cache = { paths, at: now };
    return { paths, source: "atlas" };
  } catch (err) {
    console.warn(`[atlas] feed fetch failed`, err);
    return { paths: cache?.paths ?? [], source: "error" };
  }
}

/** Build an Atlas share-card URL for a path. */
export function atlasShareUrl(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return `${atlasBaseUrl()}/s/path/${slug}`;
}
