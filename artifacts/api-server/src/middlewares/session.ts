import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export const SESSION_COOKIE = "cc_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type SessionData = {
  userId: string;
  csrfToken: string;
  issuedAt: number;
};

function sessionSecret(): string {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("APP_ENCRYPTION_KEY must be configured before issuing sessions.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare digests of equal length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createSession(userId: string, now = Date.now()): SessionData {
  return {
    userId,
    csrfToken: randomBytes(32).toString("hex"),
    issuedAt: now,
  };
}

/**
 * Serialises a session as `base64url(payload).base64url(hmac)`.
 *
 * The signature is what makes this safe: without it a caller could base64-decode
 * their own cookie and set `userId` to anyone. Verification in `parseSession`
 * must never be skipped.
 */
export function serializeSession(session: SessionData): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns null for any cookie that is malformed, forged, or expired. */
export function parseSession(raw: string | undefined, now = Date.now()): SessionData | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  if (!constantTimeEquals(signature, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Partial<SessionData>;
  if (typeof candidate.userId !== "string" || typeof candidate.csrfToken !== "string") return null;
  if (typeof candidate.issuedAt !== "number") return null;
  if (now - candidate.issuedAt > SESSION_TTL_MS) return null;

  return {
    userId: candidate.userId,
    csrfToken: candidate.csrfToken,
    issuedAt: candidate.issuedAt,
  };
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/**
 * Attaches `req.session` when a valid signed cookie is present, and mints a
 * fresh anonymous session otherwise. A tampered cookie is discarded rather
 * than trusted.
 */
export const sessionMiddleware: RequestHandler = (req, res, next) => {
  let session: SessionData | null = null;

  try {
    session = parseSession(readCookie(req.headers.cookie, SESSION_COOKIE));
  } catch {
    session = null;
  }

  if (!session) {
    session = createSession("anonymous");
  }

  req.session = session;
  res.cookie(SESSION_COOKIE, serializeSession(session), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });

  next();
};