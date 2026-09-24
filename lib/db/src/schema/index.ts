import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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