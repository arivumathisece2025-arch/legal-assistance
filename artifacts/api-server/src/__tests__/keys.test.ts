import assert from "node:assert/strict";
import test from "node:test";
import { getKey, validateEncryptionKey } from "../lib/keys";

const validHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const validBase64 = Buffer.alloc(32, 0x5a).toString("base64");

test("encryption key validation accepts 32-byte hex and base64 secrets", () => {
  assert.doesNotThrow(() => validateEncryptionKey("production", validHex));
  assert.doesNotThrow(() => validateEncryptionKey("production", validBase64));
});

test("production startup rejects missing, short and example placeholder secrets", () => {
  for (const secret of [undefined, "short", "replace-with-a-random-32-byte-token"]) {
    assert.throws(() => validateEncryptionKey("production", secret), /APP_ENCRYPTION_KEY/);
  }
});

test("non-production startup warns loudly instead of throwing for an invalid secret", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    assert.doesNotThrow(() => validateEncryptionKey("development", "replace-with-a-random-32-byte-token"));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /SECURITY WARNING/);
  } finally {
    console.warn = originalWarn;
  }
});

test("labeled encryption keys are cached and domain separated", () => {
  const previous = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = validHex;
  try {
    const signingKey = getKey("session-hmac");
    assert.strictEqual(getKey("session-hmac"), signingKey);
    assert.notDeepEqual(getKey("blob-aes"), signingKey);
  } finally {
    if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previous;
  }
});