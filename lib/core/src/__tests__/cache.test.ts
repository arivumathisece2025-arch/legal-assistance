import assert from "node:assert/strict";
import test from "node:test";
import { clearCache, configureCache, getCacheStats, getCacheValue, resetCacheConfiguration, setCacheValue } from "../cache";

test("the 501st entry evicts the oldest cache entry", () => {
  configureCache({ maxEntries: 500, ttlMs: null });
  try {
    for (let index = 0; index < 501; index += 1) setCacheValue(`key-${index}`, index);

    assert.equal(getCacheValue("key-0"), undefined);
    assert.equal(getCacheValue("key-500"), 500);
    assert.deepEqual(getCacheStats(), { hits: 1, misses: 1, size: 500 });
  } finally {
    resetCacheConfiguration();
  }
});

test("cache TTL expiry uses the injected clock", () => {
  let time = 10_000;
  configureCache({ maxEntries: 5, ttlMs: 100, now: () => time });
  try {
    setCacheValue("temporary", "value");
    time += 99;
    assert.equal(getCacheValue("temporary"), "value");
    time += 1;
    assert.equal(getCacheValue("temporary"), undefined);
    assert.equal(getCacheStats().size, 0);
  } finally {
    resetCacheConfiguration();
  }
});

test("recently used cache entries survive eviction and stats report hits and misses", () => {
  configureCache({ maxEntries: 2, ttlMs: null });
  try {
    setCacheValue("first", 1);
    setCacheValue("second", 2);
    assert.equal(getCacheValue("first"), 1);
    setCacheValue("third", 3);

    assert.equal(getCacheValue("first"), 1);
    assert.equal(getCacheValue("second"), undefined);
    assert.deepEqual(getCacheStats(), { hits: 2, misses: 1, size: 2 });
  } finally {
    resetCacheConfiguration();
  }
});

test("clearCache empties entries and resets hit and miss statistics", () => {
  configureCache({ maxEntries: 2, ttlMs: null });
  setCacheValue("key", "value");
  getCacheValue("key");
  clearCache();
  assert.deepEqual(getCacheStats(), { hits: 0, misses: 0, size: 0 });
  resetCacheConfiguration();
});