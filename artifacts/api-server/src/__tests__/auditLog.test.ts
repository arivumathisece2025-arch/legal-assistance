import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  __mutateChainForTest,
  appendAuditLog,
  listAuditLog,
  resetAuditChain,
  verifyAuditChain,
} from "../lib/auditLog";

beforeEach(() => {
  resetAuditChain();
});

test("a fresh chain verifies and starts at the genesis hash", () => {
  assert.deepEqual(verifyAuditChain(), { valid: true, length: 0 });
});

test("appended entries link to their predecessor and verify", () => {
  const first = appendAuditLog("DOCUMENT_UPLOADED", "user-1", { documentId: "doc-001" });
  const second = appendAuditLog("QUESTION_ANSWERED", "user-1", { documentId: "doc-001" });

  assert.equal(first.prevHash, "0".repeat(64));
  assert.equal(second.prevHash, first.hash);
  assert.deepEqual(verifyAuditChain(), { valid: true, length: 2 });
});

test("ids are unique across entries", () => {
  const entries = Array.from({ length: 25 }, (_, index) =>
    appendAuditLog("TEST_EVENT", "user-1", { index }),
  );

  assert.equal(new Set(entries.map((entry) => entry.id)).size, 25);
});

test("verifyAuditChain detects a mutated payload", () => {
  appendAuditLog("DATA_DELETION_REQUEST", "user-1", { documentsPurged: 2 });
  appendAuditLog("DATA_DELETION_REQUEST", "user-1", { documentsPurged: 3 });
  assert.equal(verifyAuditChain().valid, true);

  // Simulate post-hoc tampering with the first record's payload.
  __mutateChainForTest((chain) => {
    chain[0]!.payload = { documentsPurged: 999 };
  });

  const result = verifyAuditChain();
  assert.equal(result.valid, false);
  assert.equal(result.tamperedIndex, 0);
  assert.equal(result.length, 2);
});

test("verifyAuditChain detects a deleted entry", () => {
  appendAuditLog("A", "user-1", { value: 1 });
  appendAuditLog("B", "user-1", { value: 2 });
  appendAuditLog("C", "user-1", { value: 3 });

  __mutateChainForTest((chain) => {
    chain.splice(1, 1);
  });

  const result = verifyAuditChain();
  assert.equal(result.valid, false);
  assert.equal(result.tamperedIndex, 1);
});

test("resetAuditChain returns the chain to genesis", () => {
  appendAuditLog("A", "user-1", {});
  assert.equal(verifyAuditChain().length, 1);

  resetAuditChain();
  assert.deepEqual(verifyAuditChain(), { valid: true, length: 0 });
});

test("listAuditLog hands back copies that cannot mutate the chain", () => {
  appendAuditLog("ORIGINAL", "user-1", { value: 1 });

  const snapshot = listAuditLog();
  snapshot[0]!.action = "TAMPERED";

  assert.equal(verifyAuditChain().valid, true);
  assert.equal(listAuditLog()[0]!.action, "ORIGINAL");
});