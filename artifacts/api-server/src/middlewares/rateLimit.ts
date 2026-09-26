import type { RequestHandler } from "express";

type Bucket = { tokens: number; lastRefill: number };

const buckets = new Map<string, Bucket>();

/** Test hook: drops all accumulated buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

export type RateLimitOptions = {
  /** Sustained request rate. Defaults to 60. */
  limit?: number;
  /** Refill window in milliseconds. Defaults to 60_000. */
  intervalMs?: number;
};

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
    const key = req.ip ?? "unknown";
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      buckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      bucket.tokens = Math.min(limit, bucket.tokens + (elapsed / intervalMs) * limit);
      bucket.lastRefill = now;
    }

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