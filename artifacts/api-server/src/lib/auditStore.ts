import type { AuditEntry } from "./auditLog";

/**
 * Persistence wrapper for the hash-chained audit log. Entries are mirrored to
 * Postgres so they survive a process restart. Writes are best-effort and a
 * missing/unreachable database falls back to in-memory.
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

let injectedAuditStore: AuditStore | null | undefined;
let configuredDatabaseUrl: string | undefined;
let databaseAuditStore: Promise<AuditStore> | undefined;

export function setAuditStoreForTest(store: AuditStore | null | undefined): void {
  injectedAuditStore = store;
}

export async function resolveAuditStore(): Promise<AuditStore | null> {
  if (injectedAuditStore !== undefined) return injectedAuditStore;
  if (!process.env.DATABASE_URL) return null;
  const databaseUrl = process.env.DATABASE_URL;
  if (configuredDatabaseUrl !== databaseUrl) {
    configuredDatabaseUrl = databaseUrl;
    databaseAuditStore = undefined;
  }
  if (!databaseAuditStore) {
    databaseAuditStore = (async () => {
      const { db, auditLogEntries } = await import("@workspace/db");
      const { asc, sql } = await import("drizzle-orm");
      await db.execute(sql`ALTER TABLE IF EXISTS stored_documents
        ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT 'legacy-unowned'`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS audit_log_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entry_id text NOT NULL UNIQUE,
        "timestamp" timestamptz NOT NULL,
        action text NOT NULL,
        user_id text NOT NULL,
        payload jsonb NOT NULL,
        prev_hash text NOT NULL,
        hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

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
    })();
  }
  try {
    return await databaseAuditStore;
  } catch (error) {
    databaseAuditStore = undefined;
    throw error;
  }
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
  const resolved = store === undefined ? await resolveAuditStore() : store;
  if (!resolved) return [];
  return resolved.listEntries();
}
