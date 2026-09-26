import assert from "node:assert/strict";
import test from "node:test";
import { appendAuditLog, resetAuditChain, type AuditEntry } from "../lib/auditLog";
import { persistAuditEntry, readPersistedAuditEntries, type AuditStore } from "../lib/auditStore";

/**
 * ADDITIVE (scorecard item 1): verifies the DB-backed path writes and reads
 * correctly, using an in-memory fake of the Drizzle store so no live Postgres
 * is needed. Existing auditLog.test.ts is untouched.
 */
function createFakeAuditStore(): AuditStore & { rows: AuditEntry[] } {
  const rows: AuditEntry[] = [];
  return {
    rows,
    insertEntry: async (row) => {
      rows.push({
        id: row.entryId,
        timestamp: row.timestamp.toISOString(),
        action: row.action,
        userId: row.userId,
        payload: row.payload,
        prevHash: row.prevHash,
        hash: row.hash,
      });
    },
    listEntries: async () => rows.map((entry) => ({ ...entry })),
  };
}

test("audit entries written via the DB-backed path read back correctly", async () => {
  resetAuditChain();
  const store = createFakeAuditStore();
  const first = appendAuditLog("DOCUMENT_UPLOADED", "user-1", { documentId: "doc-001" });
  const second = appendAuditLog("QUESTION_ANSWERED", "user-1", { documentId: "doc-001" });

  assert.equal(await persistAuditEntry(first, store), true);
  assert.equal(await persistAuditEntry(second, store), true);

  const persisted = await readPersistedAuditEntries(store);
  assert.equal(persisted.length, 2);
  assert.deepEqual(
    persisted.map((entry) => entry.id),
    [first.id, second.id],
  );
  assert.equal(persisted[1]!.prevHash, persisted[0]!.hash);
});

test("persisted audit entries survive an in-memory restart", async () => {
  resetAuditChain();
  const store = createFakeAuditStore();
  const entry = appendAuditLog("DATA_DELETION_REQUEST", "user-1", { documentsPurged: 2 });
  assert.equal(await persistAuditEntry(entry, store), true);

  // Simulate a process restart: the in-process chain is gone.
  resetAuditChain();
  assert.equal((await readPersistedAuditEntries(store)).length, 1);

  const [restored] = await readPersistedAuditEntries(store);
  assert.equal(restored!.id, entry.id);
  assert.equal(restored!.hash, entry.hash);
  assert.equal(restored!.action, "DATA_DELETION_REQUEST");
});

test("audit persistence is a no-op without a configured store", async () => {
  resetAuditChain();
  const entry = appendAuditLog("TEST_EVENT", "user-1", { index: 0 });
  assert.equal(await persistAuditEntry(entry, null), false);
  assert.deepEqual(await readPersistedAuditEntries(null), []);
});
