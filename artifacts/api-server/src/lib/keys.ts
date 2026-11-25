import { hkdfSync } from "node:crypto";

const SECRET_LABEL = "session-hmac";
const BLOB_LABEL = "blob-aes";
const KEY_LENGTH = 32;

/**
 * Derives a domain-separated key from `APP_ENCRYPTION_KEY` using HKDF-SHA256.
 *
 * `label` binds the derived key to a single purpose so that a key derived for
 * session signing can never be reused for blob encryption (or vice versa),
 * even if the same master secret feeds both.
 *
 * Returns a fresh Buffer on every call. Callers that need a stable key should
 * memoize at their own layer (see `sessionSigningKey` / `blobAesKey`).
 */
export function getKey(label: "session-hmac" | "blob-aes"): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("APP_ENCRYPTION_KEY must be configured before deriving keys.");
  }
  const secretBuffer = Buffer.from(secret, "utf8");

  return Buffer.from(hkdfSync("sha256", secretBuffer, Buffer.alloc(0), label, KEY_LENGTH));
}