function hashStringFNV1a(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash *= 0x100000001b3n;
  }
  return hash.toString(16).padStart(16, "0");
}

export const DEFAULT_LLM_MODEL = "default";
export const CLASSIFICATION_PROMPT_VERSION = "classification.v2";

type CacheEntry = {
  value: unknown;
  expiresAt?: number;
};

export type CacheStats = {
  hits: number;
  misses: number;
  size: number;
};

export type CacheConfiguration = {
  maxEntries?: number;
  ttlMs?: number | null;
  now?: () => number;
};

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
let maxEntries = configuredMaxEntries();
let ttlMs: number | null = DEFAULT_TTL_MS;
let now = () => Date.now();
let hits = 0;
let misses = 0;

function configuredMaxEntries(): number {
  const configured = typeof process !== "undefined" ? Number(process.env.CACHE_MAX_ENTRIES) : NaN;
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_ENTRIES;
}

function removeExpiredEntries(currentTime: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt !== undefined && entry.expiresAt <= currentTime) cache.delete(key);
  }
}

function evictToLimit(): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

export async function hashCacheKey(normalizedInput: string, model: string, promptVersion: string): Promise<string> {
  const payload = `${normalizedInput}|${model}|${promptVersion}`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return hashStringFNV1a(payload);

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getCacheValue<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry || (entry.expiresAt !== undefined && entry.expiresAt <= now())) {
    if (entry) cache.delete(key);
    misses += 1;
    return undefined;
  }

  cache.delete(key);
  cache.set(key, entry);
  hits += 1;
  return entry.value as T;
}

export function setCacheValue<T>(key: string, value: T): T {
  cache.delete(key);
  cache.set(key, {
    value,
    ...(ttlMs === null ? {} : { expiresAt: now() + ttlMs }),
  });
  evictToLimit();
  return value;
}

export function clearCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

export function getCacheStats(): CacheStats {
  removeExpiredEntries(now());
  return { hits, misses, size: cache.size };
}

export function configureCache(configuration: CacheConfiguration): void {
  maxEntries = Number.isInteger(configuration.maxEntries) && (configuration.maxEntries ?? 0) > 0
    ? configuration.maxEntries!
    : configuredMaxEntries();
  ttlMs = configuration.ttlMs === null
    ? null
    : typeof configuration.ttlMs === "number" && configuration.ttlMs >= 0
      ? configuration.ttlMs
      : DEFAULT_TTL_MS;
  now = configuration.now ?? (() => Date.now());
  clearCache();
}

export function resetCacheConfiguration(): void {
  maxEntries = configuredMaxEntries();
  ttlMs = DEFAULT_TTL_MS;
  now = () => Date.now();
  clearCache();
}
