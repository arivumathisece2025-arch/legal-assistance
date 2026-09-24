import assert from "node:assert/strict";
import test from "node:test";
import { redactPii, rehydratePii } from "../pii";

test("redacts supported Indian PII kinds and rehydrates the original text", () => {
  const source = [
    "Aadhaar 100000000004",
    "PAN ABCDE1234F",
    "mobile +919876543210",
    "email test@example.com",
    "bank 123456789",
    "GSTIN 27AAPFU0939F1ZV",
    "IFSC HDFC0001234",
  ].join(", ");

  const result = redactPii(source);
  const kinds = Object.keys(result.rehydrationMap).map((token) => token.split(":")[1]);

  assert.deepEqual(kinds, ["AADHAAR", "PAN", "MOBILE", "EMAIL", "BANK_ACCOUNT", "GSTIN", "IFSC"]);
  assert.doesNotMatch(result.redacted, /100000000004|ABCDE1234F|test@example.com/);
  assert.equal(rehydratePii(result.redacted, result.rehydrationMap), source);
});

test("handles adjacent matches and prefers validated Aadhaar over an overlapping bank match", () => {
  const adjacent = redactPii("ABCDE1234F test@example.com");
  assert.match(adjacent.redacted, /^\[\[PII:PAN:1\]\] \[\[PII:EMAIL:2\]\]$/);

  const overlapping = redactPii("100000000004");
  assert.deepEqual(Object.keys(overlapping.rehydrationMap), ["[[PII:AADHAAR:1]]"]);
});