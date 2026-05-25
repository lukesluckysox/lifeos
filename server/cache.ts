/**
 * Centralized in-memory TTL cache.
 *
 * Goals:
 *   - Single, debuggable cache primitive instead of one-off Maps per route.
 *   - Consistent stats (hits / misses / sets / evictions) for ops introspection.
 *   - Bounded size with LRU-ish eviction (drop the oldest-set entry) so a
 *     pathological key space (e.g. a flood of unique city strings) can't OOM
 *     the process.
 *   - Async-safe: callers pass a producer fn and the cache deduplicates
 *     in-flight work for the same key (no thundering herd on cold caches).
 *
 * Usage:
 *
 *   const sentiment = makeCache<SentimentResult>("sentiment", {
 *     ttlMs: 5 * 60 * 1000,
 *     maxEntries: 1000,
 *   });
 *
 *   const result = await sentiment.getOrSet(`${symbol}:${weeks}`, async () => {
 *     return computeSentiment(symbol, weeks);
 *   });
 *
 * Or, with a per-call TTL override:
 *
 *   const result = await sentiment.getOrSet(key, producer, { ttlMs: 60_000 });
 *
 * For explicit get/set/invalidate semantics:
 *
 *   const hit = sentiment.peek(key);
 *   sentiment.set(key, value);
 *   sentiment.invalidate(key);
 */

export interface CacheOptions {
  /** Default time-to-live for entries, in milliseconds. */
  ttlMs: number;
  /** Maximum number of entries; oldest-set evicted first. */
  maxEntries?: number;
}

export interface CacheStats {
  name: string;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  size: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface TTLCache<V> {
  readonly name: string;
  /** Read-only — returns the cached value if still valid, else undefined. */
  peek(key: string): V | undefined;
  /** Write — always overwrites; bumps insertion order. */
  set(key: string, value: V, opts?: { ttlMs?: number }): void;
  /** Drop a single key. Returns true if it existed. */
  invalidate(key: string): boolean;
  /** Drop everything. */
  clear(): void;
  /**
   * Async cache-aside: returns the cached value or produces it via `producer`.
   * In-flight producers for the same key are deduplicated.
   */
  getOrSet(
    key: string,
    producer: () => Promise<V>,
    opts?: { ttlMs?: number }
  ): Promise<V>;
  /** Diagnostic counters. */
  stats(): CacheStats;
}

const registry: TTLCache<any>[] = [];

export function makeCache<V>(name: string, opts: CacheOptions): TTLCache<V> {
  const ttlDefault = opts.ttlMs;
  const maxEntries = opts.maxEntries ?? 10_000;

  const store = new Map<string, Entry<V>>();
  const inflight = new Map<string, Promise<V>>();

  let hits = 0;
  let misses = 0;
  let sets = 0;
  let evictions = 0;

  function evictIfNeeded() {
    while (store.size > maxEntries) {
      // Map preserves insertion order; drop the oldest.
      const oldestKey = store.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
      evictions++;
    }
  }

  function peek(key: string): V | undefined {
    const e = store.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return e.value;
  }

  function set(key: string, value: V, o?: { ttlMs?: number }): void {
    const ttl = o?.ttlMs ?? ttlDefault;
    // Re-inserting (delete first) refreshes insertion order so this entry
    // counts as "newest" for LRU-ish eviction.
    if (store.has(key)) store.delete(key);
    store.set(key, { value, expiresAt: Date.now() + ttl });
    sets++;
    evictIfNeeded();
  }

  function invalidate(key: string): boolean {
    inflight.delete(key);
    return store.delete(key);
  }

  function clear() {
    store.clear();
    inflight.clear();
  }

  async function getOrSet(
    key: string,
    producer: () => Promise<V>,
    o?: { ttlMs?: number }
  ): Promise<V> {
    const cached = peek(key);
    if (cached !== undefined) {
      hits++;
      return cached;
    }
    const pending = inflight.get(key);
    if (pending) {
      // We don't count this as a hit (no cache entry yet) and we don't
      // count it as a fresh miss either — it's a coalesced wait.
      return pending;
    }
    misses++;
    const p = (async () => {
      try {
        const value = await producer();
        set(key, value, o);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  function stats(): CacheStats {
    return { name, hits, misses, sets, evictions, size: store.size };
  }

  const cache: TTLCache<V> = {
    name,
    peek,
    set,
    invalidate,
    clear,
    getOrSet,
    stats,
  };
  registry.push(cache as TTLCache<any>);
  return cache;
}

/** Snapshot of every cache's stats — handy for a /api/_cache-stats route. */
export function allCacheStats(): CacheStats[] {
  return registry.map((c) => c.stats());
}

// Common TTLs — name them so call sites read intentfully.
export const TTL = {
  SECONDS_30: 30 * 1000,
  MIN_5: 5 * 60 * 1000,
  MIN_15: 15 * 60 * 1000,
  HOUR_1: 60 * 60 * 1000,
  HOUR_6: 6 * 60 * 60 * 1000,
  HOUR_12: 12 * 60 * 60 * 1000,
  HOUR_24: 24 * 60 * 60 * 1000,
} as const;
