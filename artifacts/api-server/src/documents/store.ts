import { buildRetrievalIndex, type Clause, type ParsedDocument, type RetrievalIndex } from "@workspace/core";
import { seedDocument, seedRevisedDocument } from "./seedData";

export type DocumentRecord = {
  id: string;
  ownerId: string;
  name: string;
  fileType: string;
  uploadedAt: string;
  status: "uploaded" | "analyzing" | "ready";
  pageCount: number;
  clauseCount: number;
  riskScore: number;
  highRiskCount: number;
  scannedDetected: boolean;
  securityFindings: Array<{
    label: string;
    detail: string;
    page: number;
  }>;
  injectionFindings: Array<{
    pattern: string;
    page: number;
    offset: number;
    severity: "info" | "warning";
  }>;
  encryptedBlob?: string;
  expiresAt?: string;
  retrievalIndex?: RetrievalIndex;
  sourcePages?: ParsedDocument["pages"];
  clauses: Array<{
    id: string;
    ordinal: string;
    heading: string;
    type: string;
    severity: "low" | "medium" | "high";
    summary: string;
    text: string;
  }>;
};

export const documents = new Map<string, DocumentRecord>([
  [seedDocument.id, withRetrievalIndex(seedDocument)],
  [seedRevisedDocument.id, withRetrievalIndex(seedRevisedDocument)],
]);
const MAX_USER_DOCUMENTS = 200;

export function toCoreClauses(clauses: DocumentRecord["clauses"]): Clause[] {
  return clauses.map((clause, index) => ({
    id: clause.id,
    ordinal: clause.ordinal,
    heading: clause.heading,
    text: clause.text,
    page: 1,
    charStart: index,
    charEnd: index + clause.text.length,
  }));
}

function withRetrievalIndex(document: DocumentRecord): DocumentRecord {
  return { ...document, retrievalIndex: buildRetrievalIndex(toCoreClauses(document.clauses)) };
}

export function toPublicDocument(document: DocumentRecord): Omit<DocumentRecord, "encryptedBlob" | "retrievalIndex" | "sourcePages"> {
  const { encryptedBlob: _encryptedBlob, retrievalIndex: _retrievalIndex, sourcePages: _sourcePages, ...publicDocument } = document;
  return publicDocument;
}

function touchDocument(id: string, document: DocumentRecord): DocumentRecord {
  documents.delete(id);
  documents.set(id, document);
  return document;
}

export function storeDocument(document: DocumentRecord): void {
  touchDocument(document.id, document);
  while (Array.from(documents.values()).filter((record) => record.ownerId !== "public").length > MAX_USER_DOCUMENTS) {
    const leastRecentlyUsed = Array.from(documents.entries()).find(([, record]) => record.ownerId !== "public");
    if (!leastRecentlyUsed) break;
    documents.delete(leastRecentlyUsed[0]);
  }
}

export function getDocumentRecord(id: string): DocumentRecord | undefined {
  const document = documents.get(id);
  return document ? touchDocument(id, document) : undefined;
}

/**
 * Returns the document record only if the caller may access it:
 * `ownerId === userId` or the document is owned by "public" (readable by everyone).
 * Returns undefined (not 403) when inaccessible, so callers can respond with 404.
 *
 * An expired record is treated as not found and removed from the store.
 */
export function getAccessibleDocument(id: string, userId: string): DocumentRecord | undefined {
  const document = documents.get(id);
  if (!document) return undefined;

  if (document.expiresAt && Date.now() >= new Date(document.expiresAt).getTime()) {
    documents.delete(id);
    return undefined;
  }

  if (document.ownerId === userId || document.ownerId === "public") {
    return touchDocument(id, document);
  }
  return undefined;
}

export function sweepExpiredMemoryDocuments(now: Date = new Date()): string[] {
  const expiredIds: string[] = [];
  for (const [id, document] of documents) {
    if (document.expiresAt && new Date(document.expiresAt).getTime() <= now.getTime()) {
      documents.delete(id);
      expiredIds.push(id);
    }
  }
  return expiredIds;
}

/**
 * Removes every in-memory document owned by `userId`, returning the ids that were dropped.
 * Public ("ownerId === 'public'") documents are never removed by this call.
 */
export function purgeDocumentsFor(userId: string): string[] {
  const purged: string[] = [];
  for (const [id, document] of documents) {
    if (document.ownerId === userId && document.ownerId !== "public") {
      documents.delete(id);
      purged.push(id);
    }
  }
  return purged;
}