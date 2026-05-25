/**
 * Cache tests — TTL behavior, LRU-ish eviction, async coalescing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeCache, TTL } from "../cache";

describe("makeCache", () => {
  it("returns cached value within TTL and re-runs after expiry", async () => {
    const cache = makeCache<number>("test-ttl", { ttlMs: 50 });
    let calls = 0;
    const get = () =>
      cache.getOrSet("k", async () => {
        calls++;
        return 42;
      });
    assert.equal(await get(), 42);
    assert.equal(await get(), 42);
    assert.equal(calls, 1);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(await get(), 42);
    assert.equal(calls, 2);
  });

  it("coalesces in-flight producers for the same key (no thundering herd)", async () => {
    const cache = makeCache<number>("test-dedupe", { ttlMs: TTL.MIN_5 });
    let calls = 0;
    const producer = () =>
      new Promise<number>((resolve) =>
        setTimeout(() => {
          calls++;
          resolve(7);
        }, 30)
      );
    const all = await Promise.all([
      cache.getOrSet("k", producer),
      cache.getOrSet("k", producer),
      cache.getOrSet("k", producer),
    ]);
    assert.deepEqual(all, [7, 7, 7]);
    assert.equal(calls, 1, "producer should run exactly once across concurrent callers");
  });

  it("evicts oldest entries when maxEntries is exceeded", () => {
    const cache = makeCache<number>("test-evict", { ttlMs: TTL.MIN_5, maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4); // should evict "a"
    assert.equal(cache.peek("a"), undefined);
    assert.equal(cache.peek("b"), 2);
    assert.equal(cache.peek("c"), 3);
    assert.equal(cache.peek("d"), 4);
    const stats = cache.stats();
    assert.equal(stats.evictions, 1);
    assert.equal(stats.size, 3);
  });

  it("invalidate drops the key and lets the next call refetch", async () => {
    const cache = makeCache<number>("test-invalidate", { ttlMs: TTL.HOUR_1 });
    let calls = 0;
    const get = () =>
      cache.getOrSet("k", async () => {
        calls++;
        return calls;
      });
    assert.equal(await get(), 1);
    assert.equal(await get(), 1);
    cache.invalidate("k");
    assert.equal(await get(), 2);
  });
});
