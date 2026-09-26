import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const storedDocuments = pgTable("stored_documents", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	fileType: text("file_type").notNull(),
	encryptedBlob: text("encrypted_blob").notNull(),
	metadata: jsonb("metadata").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type StoredDocument = typeof storedDocuments.$inferSelect;
export type NewStoredDocument = typeof storedDocuments.$inferInsert;

/**
 * ADDITIVE (scorecard item 1): durable mirror of the in-process hash-chained
 * audit log (`artifacts/api-server/src/lib/auditLog.ts`). The in-memory chain
 * stays authoritative for tamper detection; this table exists so entries
 * survive a process restart. Rows are append-only by convention (no
 * update/delete API is exposed). Requires `drizzle-kit push` before inserts
 * succeed in a provisioned database.
 */
export const auditLogEntries = pgTable("audit_log_entries", {
	id: uuid("id").defaultRandom().primaryKey(),
	entryId: text("entry_id").notNull().unique(),
	timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
	action: text("action").notNull(),
	userId: text("user_id").notNull(),
	payload: jsonb("payload").notNull(),
	prevHash: text("prev_hash").notNull(),
	hash: text("hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AuditLogEntryRow = typeof auditLogEntries.$inferSelect;
export type NewAuditLogEntryRow = typeof auditLogEntries.$inferInsert;