import { hkdfSync } from "node:crypto";

const KEY_LENGTH = 32;
const PLACEHOLDER_KEYS = new Set(["replace-with-a-random-32-byte-token"]);
const derivedKeys = new Map<string, Buffer>();
let cachedSecret: string | undefined;

function isValidSecret(secret: string | undefined): secret is string {
  if (!secret || PLACEHOLDER_KEYS.has(secret.trim().toLowerCase())) return false;

  if (/^(?:[0-9a-f]{2}){32,}$/i.test(secret)) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret)) return false;

  const decoded = Buffer.from(secret, "base64");
  return decoded.byteLength >= KEY_LENGTH && decoded.toString("base64").replace(/=+$/, "") === secret.replace(/=+$/, "");
}

export function validateEncryptionKey(environment = process.env.NODE_ENV, secret = process.env.APP_ENCRYPTION_KEY): void {
  if (isValidSecret(secret)) return;

  const message = "APP_ENCRYPTION_KEY must be a non-placeholder 32-byte (or longer) hex or base64 secret.";
  if (environment === "production") throw new Error(message);
  console.warn(`SECURITY WARNING: ${message}`);
}

/**
 * Derives a domain-separated key from `APP_ENCRYPTION_KEY` using HKDF-SHA256.
 *
 * `label` binds the derived key to a single purpose so that a key derived for
 * session signing can never be reused for blob encryption (or vice versa),
 * even if the same master secret feeds both.
 *
 * Derives each labeled key once per configured master secret.
 */
export function getKey(label: "session-hmac" | "blob-aes"): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("APP_ENCRYPTION_KEY must be configured before deriving keys.");
  }
  if (cachedSecret !== secret) {
    cachedSecret = secret;
    derivedKeys.clear();
  }

  let key = derivedKeys.get(label);
  if (!key) {
    const secretBuffer = Buffer.from(secret, "utf8");
    key = Buffer.from(hkdfSync("sha256", secretBuffer, Buffer.alloc(0), label, KEY_LENGTH));
    derivedKeys.set(label, key);
  }
  return key;
}