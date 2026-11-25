import { createCipheriv, randomBytes } from "node:crypto";
import { getKey } from "../lib/keys";
import type { DocumentRecord } from "./store";

export function encryptBlob(bytes: Uint8Array): string {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) throw new Error("APP_ENCRYPTION_KEY must be configured before storing uploads.");
  const key = getKey("blob-aes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export async function persistEncryptedDocument(document: DocumentRecord, encryptedBlob: string, expiresAt: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const { db, storedDocuments } = await import("@workspace/db");
  await db.insert(storedDocuments).values({
    id: document.id,
    ownerId: document.ownerId,
    name: document.name,
    fileType: document.fileType,
    encryptedBlob,
    metadata: {
      pageCount: document.pageCount,
      clauses: document.clauses,
      injectionFindings: document.injectionFindings,
    },
    createdAt: new Date(document.uploadedAt),
    expiresAt: new Date(expiresAt),
  });
}