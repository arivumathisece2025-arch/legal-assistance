import type { AuditEntry } from "./auditLog";

/**
 * ADDITIVE (scorecard item 1): persistence wrapper for the hash-chained audit
 * log. The in-memory chain stays authoritative; this layer mirrors entries to
 * Postgres so they survive a process restart. Never throws: persistence is
 * best-effort and a missing/unreachable database falls back to in-memory.
 *
 * `AuditStore` is the minimal write/read contract so tests can inject a fake
 * without a live Postgres. Production wiring passes no store, in which case
 * `resolveAuditStore` lazily imports `@workspace/db` only when DATABASE_URL
 * is configured (same pattern as document storage in routes/documents.ts).
 */
export type AuditStore = {
  insertEntry: (row: {
    entryId: string;
    timestamp: Date;
    action: string;
    userId: string;
    payload: Record<string, unknown>;
    prevHash: string;
    hash: string;
  }) => Promise<void>;
  listEntries: () => Promise<AuditEntry[]>;
};

export async function resolveAuditStore(): Promise<AuditStore | null> {
  if (!process.env.DATABASE_URL) return null;
  const { db, auditLogEntries } = await import("@workspace/db");
  const { asc } = await import("drizzle-orm");
  return {
    insertEntry: async (row) => {
      await db.insert(auditLogEntries).values({
        entryId: row.entryId,
        timestamp: row.timestamp,
        action: row.action,
        userId: row.userId,
        payload: row.payload,
        prevHash: row.prevHash,
        hash: row.hash,
      });
    },
    listEntries: async () => {
      const rows = await db.select().from(auditLogEntries).orderBy(asc(auditLogEntries.createdAt));
      return rows.map((row) => ({
        id: row.entryId,
        timestamp: (row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp)).toISOString(),
        action: row.action,
        userId: row.userId,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        prevHash: row.prevHash,
        hash: row.hash,
      }));
    },
  };
}

/** Persist one entry; returns true when persisted, false when skipped/failed. */
export async function persistAuditEntry(entry: AuditEntry, store?: AuditStore | null): Promise<boolean> {
  const resolved = store === undefined ? await resolveAuditStore().catch(() => null) : store;
  if (!resolved) return false;
  try {
    await resolved.insertEntry({
      entryId: entry.id,
      timestamp: new Date(entry.timestamp),
      action: entry.action,
      userId: entry.userId,
      payload: entry.payload,
      prevHash: entry.prevHash,
      hash: entry.hash,
    });
    return true;
  } catch {
    return false;
  }
}

/** Read back persisted entries (survive a process restart); [] when no database. */
export async function readPersistedAuditEntries(store?: AuditStore | null): Promise<AuditEntry[]> {
  const resolved = store === undefined ? await resolveAuditStore().catch(() => null) : store;
  if (!resolved) return [];
  try {
    return await resolved.listEntries();
  } catch {
    return [];
  }
}
