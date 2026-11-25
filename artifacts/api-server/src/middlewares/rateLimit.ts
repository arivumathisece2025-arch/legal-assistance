import type { RequestHandler } from "express";

type Bucket = { tokens: number; lastRefill: number; limit: number; intervalMs: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
const BUCKET_SWEEP_INTERVAL_MS = 60_000;

function enforceBucketLimit(): void {
  while (buckets.size > MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

/** Test hook: drops all accumulated buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function evictRateLimitBuckets(now = Date.now()): void {
  for (const [key, bucket] of buckets) {
    const age = now - bucket.lastRefill;
    const refilledTokens = Math.min(bucket.limit, bucket.tokens + (age / bucket.intervalMs) * bucket.limit);
    if (age > 2 * bucket.intervalMs && refilledTokens >= bucket.limit) buckets.delete(key);
  }

  enforceBucketLimit();
}

export function rateLimitBucketCountForTest(): number {
  return buckets.size;
}

export type RateLimitOptions = {
  /** Sustained request rate. Defaults to 60. */
  limit?: number;
  /** Refill window in milliseconds. Defaults to 60_000. */
  intervalMs?: number;
};

const bucketSweepTimer = setInterval(() => evictRateLimitBuckets(), BUCKET_SWEEP_INTERVAL_MS);
if (typeof bucketSweepTimer.unref === "function") bucketSweepTimer.unref();

/**
 * Token-bucket rate limiter.
 *
 * Keys on the client address. The original spec fell back to the `host`
 * header, which is the *destination* server - every user behind one host
 * shared a single bucket, throttling the whole userbase at once. Express
 * derives `req.ip` from the socket, honouring `trust proxy` when it is set.
 */
export function rateLimit(options: RateLimitOptions = {}): RequestHandler {
  const limit = options.limit ?? 60;
  const intervalMs = options.intervalMs ?? 60_000;

  return (req, res, next) => {
    const key = `${limit}:${intervalMs}:${req.ip ?? "unknown"}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now, limit, intervalMs };
      buckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      bucket.tokens = Math.min(limit, bucket.tokens + (elapsed / intervalMs) * limit);
      bucket.lastRefill = now;
      buckets.delete(key);
      buckets.set(key, bucket);
    }

    enforceBucketLimit();

    if (bucket.tokens < 1) {
      const retryAfterMs = Math.max(0, Math.ceil((1 - bucket.tokens) * (intervalMs / limit)));
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      res.setHeader("X-RateLimit-Remaining", "0");
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    bucket.tokens -= 1;
    res.setHeader("X-RateLimit-Remaining", Math.floor(bucket.tokens).toString());
    next();
  };
}