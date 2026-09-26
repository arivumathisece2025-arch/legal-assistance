import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-csrf-token";

function tokensMatch(sent: string, expected: string): boolean {
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Double-submit CSRF check for state-changing requests.
 *
 * Requires the caller to echo the `csrfToken` bound to their signed session in
 * the `x-csrf-token` header. A cross-site attacker can force the browser to
 * send the cookie but cannot read it to set the header, so a match proves the
 * request came from our own front end.
 */
export const csrfProtection: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const expected = req.session?.csrfToken;
  const sent = req.get(CSRF_HEADER);

  if (!expected || !sent || !tokensMatch(sent, expected)) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
};