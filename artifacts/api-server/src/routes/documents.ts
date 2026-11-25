import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import multer from "multer";
import { Router, type IRouter } from "express";
import { getKey } from "../lib/keys";
import { createLogger } from "../lib/secureLogger";
import { appendAuditLog, hashAuditIdentifier } from "../lib/auditLog";
import {
  answerQuestion,
  streamAnswerQuestion,
  compareVersions,
  GroqProvider,
  IngestionError,
  MockProvider,
  classifyClauses,
  processUpload,
  buildRetrievalIndex,
  segmentDocument,
  simplifyClauses,
  type AlignableClause,
  type Clause,
  type LLMProvider,
  type ParsedDocument,
  type RetrievalIndex,
} from "@workspace/core";
import {
  AnalyzeDocumentParams,
  AnalyzeDocumentResponse,
  AskQuestionBody,
  AskQuestionResponse,
  CompareDocumentVersionsBody,
  CompareDocumentVersionsParams,
  CompareDocumentVersionsResponse,
  CreateDocumentBody,
  CreateDocumentResponse,
  GetDocumentParams,
  GetDocumentResponse,
  ListDocumentsResponse,
  SimplifyDocumentBody,
  SimplifyDocumentResponse,
} from "@workspace/api-zod";

type DocumentRecord = {
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const secureLogger = createLogger("api-server");

function toCoreClauses(clauses: DocumentRecord["clauses"]): Clause[] {
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

function groqProvider(model?: string): GroqProvider {
  return new GroqProvider({
    ...(model ? { model } : {}),
    onUpstreamError: (status, upstreamBody) => {
      secureLogger.error("LLM upstream request failed", { status, body: upstreamBody });
    },
  });
}

function encryptBlob(bytes: Uint8Array): string {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) throw new Error("APP_ENCRYPTION_KEY must be configured before storing uploads.");
  const key = getKey("blob-aes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

async function persistEncryptedDocument(document: DocumentRecord, encryptedBlob: string, expiresAt: string): Promise<void> {
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

function toPublicDocument(document: DocumentRecord): Omit<DocumentRecord, "encryptedBlob" | "retrievalIndex" | "sourcePages"> {
  const { encryptedBlob: _encryptedBlob, retrievalIndex: _retrievalIndex, sourcePages: _sourcePages, ...publicDocument } = document;
  return publicDocument;
}

const seedDocument: DocumentRecord = {
  id: "doc-001",
  ownerId: "public",
  name: "Northstar Services Agreement",
  fileType: "PDF",
  uploadedAt: "2026-09-21T08:30:00.000Z",
  status: "ready",
  pageCount: 14,
  clauseCount: 18,
  riskScore: 62,
  highRiskCount: 3,
  scannedDetected: false,
  securityFindings: [
    {
      label: "No hidden instructions found",
      detail: "The document passed the prompt-injection scan.",
      page: 1,
    },
  ],
  injectionFindings: [],
  clauses: [
    {
      id: "C4",
      ordinal: "4",
      heading: "Payment terms",
      type: "payment",
      severity: "medium",
      summary: "Invoices are payable within 60 days of receipt.",
      text: "Client shall pay each undisputed invoice within sixty (60) days of receipt.",
    },
    {
      id: "C7",
      ordinal: "7",
      heading: "Indemnification",
      type: "indemnity",
      severity: "high",
      summary: "The indemnity is not subject to a stated monetary cap.",
      text: "Provider shall indemnify, defend, and hold harmless Client from any and all claims, losses, damages, liabilities, and expenses arising from the Services.",
    },
    {
      id: "C9",
      ordinal: "9",
      heading: "Confidentiality",
      type: "confidentiality",
      severity: "low",
      summary: "Confidentiality duties continue after the agreement ends.",
      text: "Each party shall protect Confidential Information using reasonable care and shall not disclose it to any third party.",
    },
    {
      id: "C12",
      ordinal: "12",
      heading: "Termination",
      type: "termination",
      severity: "high",
      summary: "The client can terminate for convenience while the provider cannot.",
      text: "Client may terminate this Agreement for convenience upon thirty (30) days' written notice. Provider may not terminate for convenience.",
    },
    {
      id: "C15",
      ordinal: "15",
      heading: "Governing law",
      type: "jurisdiction",
      severity: "medium",
      summary: "The agreement uses Indian law with courts in Singapore.",
      text: "This Agreement is governed by the laws of India. The courts of Singapore shall have exclusive jurisdiction.",
    },
  ],
};

const seedRevisedDocument: DocumentRecord = {
  id: "doc-002",
  ownerId: "public",
  name: "Northstar Services Agreement (revised)",
  fileType: "PDF",
  uploadedAt: "2026-09-22T10:05:00.000Z",
  status: "ready",
  pageCount: 15,
  clauseCount: 5,
  riskScore: 71,
  highRiskCount: 4,
  scannedDetected: false,
  securityFindings: [
    {
      label: "No hidden instructions found",
      detail: "The document passed the prompt-injection scan.",
      page: 1,
    },
  ],
  injectionFindings: [],
  clauses: [
    {
      id: "R4",
      ordinal: "4",
      heading: "Payment terms",
      type: "payment",
      severity: "high",
      summary: "Invoices are payable within 90 days of receipt.",
      text: "Client shall pay each undisputed invoice within 90 days of receipt.",
    },
    {
      id: "R5",
      ordinal: "5",
      heading: "Data processing",
      type: "data_privacy",
      severity: "high",
      summary: "Personal data may be shared with unnamed third parties.",
      text: "The Provider may share personal data with affiliates, service providers and third parties for processing and marketing.",
    },
    {
      id: "R7",
      ordinal: "7",
      heading: "Indemnification",
      type: "indemnity",
      severity: "high",
      summary: "The indemnity is unlimited and has no cap.",
      text: "Provider shall indemnify, defend, and hold harmless Client from any and all claims, losses, damages, liabilities, and expenses arising from the Services, without cap and without limit.",
    },
    {
      id: "R12",
      ordinal: "12",
      heading: "Termination",
      type: "termination",
      severity: "high",
      summary: "The client can terminate for convenience while the provider cannot.",
      text: "Client may terminate this Agreement for convenience upon thirty (30) days' written notice. Provider may not terminate for convenience.",
    },
    {
      id: "R15",
      ordinal: "15",
      heading: "Governing law",
      type: "jurisdiction",
      severity: "medium",
      summary: "The agreement uses Indian law with courts in Singapore.",
      text: "This Agreement is governed by the laws of India. The courts of Singapore shall have exclusive jurisdiction.",
    },
  ],
};

const documents = new Map<string, DocumentRecord>([
  [seedDocument.id, withRetrievalIndex(seedDocument)],
  [seedRevisedDocument.id, withRetrievalIndex(seedRevisedDocument)],
]);
const MAX_USER_DOCUMENTS = 200;

function touchDocument(id: string, document: DocumentRecord): DocumentRecord {
  documents.delete(id);
  documents.set(id, document);
  return document;
}

function storeDocument(document: DocumentRecord): void {
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

/**
 * Builds the provider used for grounded document Q&A.
 *
 * This used to be an inline object literal that string-concatenated a quote
 * from the top-ranked clause. It was never an LLM call: it ignored the system
 * prompt, ignored the configured models, and bypassed nothing useful, because
 * `answerQuestion` already performs its own retrieval, citation, and grounding
 * verification. The result was a canned quote presented as a grounded answer.
 *
 * Model selection is explicit rather than inherited from `GroqProvider`'s
 * default, so that "which model answers a user's question" is answerable by
 * reading this line rather than by inference.
 */
function answerProvider(): LLMProvider {
  if (process.env.MOCK_LLM === "1") {
    return new MockProvider();
  }

  const smartModel = process.env.GROQ_MODEL_SMART ?? process.env.GROQ_MODEL_FAST;
  return groqProvider(smartModel);
}

async function classifyDocumentPages(pages: ParsedDocument["pages"]): Promise<DocumentRecord["clauses"]> {
  const parsed: ParsedDocument = { pageCount: pages.length, pages, headings: [], isScanned: false };
  const clauses = segmentDocument(parsed);
  if (!clauses.length) return [];

  const classifications = await classifyClauses(answerProvider(), clauses);
  const byId = new Map(classifications.map((classification) => [classification.clauseId, classification]));
  return clauses.map((clause) => {
    const classification = byId.get(clause.id);
    return {
      id: clause.id,
      ordinal: clause.ordinal,
      heading: clause.heading,
      type: classification?.type ?? "other",
      severity: classification?.severity ?? "low",
      summary: classification?.summary || clause.text.split(/[.!?]/)[0]?.slice(0, 160) || clause.heading,
      text: clause.text,
    };
  });
}

/**
 * Perspective participates in answer caching so the same question can be
 * prepared independently for either party.
 */
export async function answerDocumentQuestion(
  documentId: string,
  userId: string,
  question: string,
  perspective: "party_a" | "party_b",
  language: string = "en",
  stream?: { onToken: (token: string) => void; signal: AbortSignal },
) {
  const document = getAccessibleDocument(documentId, userId);
  if (!document) {
    throw new Error("Document not found");
  }

  const clauses = document.retrievalIndex?.clauses ?? toCoreClauses(document.clauses);

  const provider = answerProvider();
  const answerOptions = {
    retrievalIndex: document.retrievalIndex,
    cacheScope: document.id,
    perspective,
  };
  const result = stream
    ? await streamAnswerQuestion(question, clauses, provider, language, answerOptions, stream.onToken, stream.signal)
    : await answerQuestion(question, clauses, provider, language, answerOptions);
  const citations = result.citations.map((clauseId) => {
    const clause = document.clauses.find((candidate) => candidate.id === clauseId);
    return {
      clauseId,
      label: clause ? `${clause.ordinal} · ${clause.heading}` : clauseId,
    };
  });

  const response = AskQuestionResponse.parse({
    answer: result.answer,
    citations,
    groundingRatio: result.groundingRatio,
    adviceMode: result.adviceMode,
    queued: false,
  });
  appendAuditLog("DOCUMENT_ASK", userId, { documentIdHash: hashAuditIdentifier(document.id) });
  return response;
}

const router: IRouter = Router();

router.get("/documents", (req, res) => {
  const userId = req.session?.userId ?? "";
  const response = Array.from(documents.values())
    .filter((document) => document.ownerId === "public" || document.ownerId === userId)
    .map((document) => {
      const { clauses: _clauses, ...summary } = toPublicDocument(document);
      return summary;
    });
  res.json(ListDocumentsResponse.parse(response));
});

router.post("/documents/upload", (req, res, next): void => {
  upload.single("file")(req, res, (error: unknown) => {
    if (error) {
      res.status(413).json({ code: "FILE_TOO_LARGE", message: "Upload exceeds the 15 MB limit." });
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ code: "FILE_REQUIRED", message: "Multipart field `file` is required." });
    return;
  }

  try {
    const processed = await processUpload(req.file.buffer);
    const id = `doc-${randomUUID()}`;
    const uploadedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ownerId = req.session!.userId;
    const sourcePages = processed.redactedPages;
    const clauses = await classifyDocumentPages(sourcePages);
    const document: DocumentRecord = {
      id,
      ownerId,
      name: req.file.originalname,
      fileType: processed.fileType.toUpperCase(),
      uploadedAt,
      status: "ready",
      pageCount: processed.pageCount,
      clauseCount: clauses.length,
      riskScore: 0,
      highRiskCount: 0,
      scannedDetected: processed.isScanned,
      securityFindings: processed.securityFindings.map((finding) => ({
        label: finding.pattern,
        detail: `Prompt-injection signal detected at offset ${finding.offset}.`,
        page: finding.page,
      })),
      injectionFindings: processed.securityFindings,
      clauses,
      sourcePages,
      retrievalIndex: buildRetrievalIndex(toCoreClauses(clauses)),
    };
    const encryptedBlob = encryptBlob(req.file.buffer);
    document.encryptedBlob = encryptedBlob;
    document.expiresAt = expiresAt;
    await persistEncryptedDocument(document, encryptedBlob, expiresAt);
    storeDocument(document);
    appendAuditLog("DOCUMENT_UPLOAD", ownerId, { documentIdHash: hashAuditIdentifier(id), fileType: document.fileType });
    res.status(201).json(toPublicDocument(document));
  } catch (error) {
    if (error instanceof IngestionError) {
      res.status(error.code === "SCANNED_DOCUMENT" ? 422 : 400).json({ code: error.code, message: error.message });
      return;
    }
    res.status(500).json({ code: "UPLOAD_FAILED", message: "Upload could not be processed." });
  }
});

router.post("/documents", (req, res): void => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = `doc-${randomUUID()}`;
  const document: DocumentRecord = {
    id,
    ownerId: req.session!.userId,
    name: parsed.data.name,
    fileType: parsed.data.fileType.toUpperCase(),
    uploadedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: "uploaded",
    pageCount: 0,
    clauseCount: 0,
    riskScore: 0,
    highRiskCount: 0,
    scannedDetected: false,
    securityFindings: [],
    injectionFindings: [],
    clauses: [],
    retrievalIndex: buildRetrievalIndex([]),
  };

  storeDocument(document);
  appendAuditLog("DOCUMENT_UPLOAD", req.session!.userId, { documentIdHash: hashAuditIdentifier(id), fileType: document.fileType });
  res.status(201).json(CreateDocumentResponse.parse(toPublicDocument(document)));
});

router.get("/documents/:id", (req, res): void => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const document = getAccessibleDocument(params.data.id, req.session?.userId ?? "");
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(GetDocumentResponse.parse(toPublicDocument(document)));
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = req.session?.userId ?? "";
  const document = getAccessibleDocument(params.data.id, userId);
  if (!document || document.ownerId !== userId || document.ownerId === "public") {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  try {
    if (process.env.DATABASE_URL) {
      const { and, eq } = await import("drizzle-orm");
      const { db, storedDocuments } = await import("@workspace/db");
      await db.delete(storedDocuments).where(and(
        eq(storedDocuments.id, document.id),
        eq(storedDocuments.ownerId, userId),
      ));
    }
    documents.delete(document.id);
    appendAuditLog("DOCUMENT_DELETE", userId, { documentIdHash: hashAuditIdentifier(document.id) });
    res.status(204).end();
  } catch {
    res.status(500).json({ code: "DOCUMENT_DELETE_FAILED", message: "Document could not be deleted." });
  }
});

router.post("/documents/:id/ask", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const document = getAccessibleDocument(params.data.id, req.session?.userId ?? "");
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const payload = { ...req.body, documentId: params.data.id };
  const parsed = AskQuestionBody.safeParse(payload);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const wantsSse = req.headers.accept?.includes("text/event-stream") || req.query.stream === "sse";
  const controller = wantsSse ? new AbortController() : undefined;
  const abortOnDisconnect = () => {
    if (controller && (req.aborted || (res.destroyed && !res.writableEnded))) controller.abort();
  };
  if (wantsSse) {
    req.on("close", abortOnDisconnect);
    res.on("close", abortOnDisconnect);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: status\ndata: ${JSON.stringify({ step: "retrieving" })}\n\n`);
  }

  try {
    const result = await answerDocumentQuestion(
      parsed.data.documentId,
      req.session?.userId ?? "",
      parsed.data.question,
      parsed.data.perspective,
      parsed.data.language ?? "en",
      wantsSse && controller
        ? {
          signal: controller.signal,
          onToken: (token: string) => {
            if (!res.destroyed && !res.writableEnded) res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
          },
        }
        : undefined,
    );

    if (wantsSse) {
      if (!res.destroyed && !res.writableEnded) {
        res.write(`event: answer\ndata: ${JSON.stringify(result)}\n\n`);
        res.write("event: done\ndata: {\"ok\":true}\n\n");
        res.end();
      }
      return;
    }

    res.json(result);
  } catch (error) {
    if (wantsSse) {
      if (!res.destroyed && !res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ code: "ASK_FAILED", message: "Answer could not be generated." })}\n\n`);
        res.end();
      }
      return;
    }

    if (error instanceof Error && error.message === "Document not found") {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.status(500).json({ code: "ASK_FAILED", message: "Answer could not be generated." });
  } finally {
    if (wantsSse) {
      req.off("close", abortOnDisconnect);
      res.off("close", abortOnDisconnect);
    }
  }
});

router.post("/documents/:id/simplify", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  const body = SimplifyDocumentBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error?.message : params.error.message });
    return;
  }

  const document = getAccessibleDocument(params.data.id, req.session?.userId ?? "");
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const clauseIds = body.data.clauseIds;
  const clauses = clauseIds
    ? document.clauses.filter((clause) => clauseIds.includes(clause.id))
    : document.clauses;
  if (clauseIds && clauses.length !== new Set(clauseIds).size) {
    res.status(400).json({ error: "One or more clauseIds do not belong to this document." });
    return;
  }

  try {
    const items = await simplifyClauses(clauses, answerProvider(), body.data.language);
    res.json(SimplifyDocumentResponse.parse({ items }));
  } catch {
    res.status(500).json({ code: "SIMPLIFY_FAILED", message: "Plain-language rewrite failed." });
  }
});

function toComparableClause(clause: DocumentRecord["clauses"][number]): AlignableClause {
  return {
    id: clause.id,
    ordinal: clause.ordinal,
    heading: clause.heading,
    text: clause.text,
    type: clause.type,
  };
}

/**
 * Phase 7 sends only the changed pairs to the reasoning tier. Nothing here
 * hardcodes a model name: the smart tier is read from the environment and
 * falls back to the provider default when it is not configured.
 */
function versionDiffProvider() {
  if (process.env.MOCK_LLM === "1") {
    return new MockProvider();
  }

  const smartModel = process.env.GROQ_MODEL_SMART ?? process.env.GROQ_MODEL_FAST;
  return groqProvider(smartModel);
}

router.post("/documents/:id/compare", async (req, res): Promise<void> => {
  const params = CompareDocumentVersionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CompareDocumentVersionsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = req.session?.userId ?? "";
  const revisedDocument = getAccessibleDocument(params.data.id, userId);
  const baseDocument = getAccessibleDocument(body.data.against, userId);
  if (!revisedDocument || !baseDocument) {
    res.status(404).json({ error: "Version not found" });
    return;
  }

  if (revisedDocument.id === baseDocument.id) {
    res.status(400).json({ error: "Choose two different versions to compare." });
    return;
  }

  const perspective =
    body.data.perspective === "party_a" ? "partyA" : body.data.perspective === "party_b" ? "partyB" : "both";

  try {
    const comparison = await compareVersions(
      {
        id: baseDocument.id,
        name: baseDocument.name,
        clauses: baseDocument.clauses.map(toComparableClause),
      },
      {
        id: revisedDocument.id,
        name: revisedDocument.name,
        clauses: revisedDocument.clauses.map(toComparableClause),
      },
      { perspective, provider: versionDiffProvider() },
    );

    appendAuditLog("DOCUMENT_COMPARE", userId, {
      baseDocumentIdHash: hashAuditIdentifier(baseDocument.id),
      revisedDocumentIdHash: hashAuditIdentifier(revisedDocument.id),
    });
    res.json(CompareDocumentVersionsResponse.parse(comparison));
  } catch (error) {
    res.status(500).json({
      code: "COMPARE_FAILED",
      message: "Comparison failed.",
    });
  }
});

router.post("/documents/:id", async (req, res): Promise<void> => {
  const params = AnalyzeDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const document = getAccessibleDocument(params.data.id, req.session?.userId ?? "");
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!document.sourcePages?.length) {
    res.status(409).json({ code: "DOCUMENT_TEXT_REQUIRED", message: "This workspace has no source text to analyze." });
    return;
  }

  try {
    const clauses = await classifyDocumentPages(document.sourcePages);
    if (!clauses.length) {
      res.status(409).json({ code: "CLAUSES_NOT_FOUND", message: "No clauses could be segmented from this document." });
      return;
    }
    const analyzed: DocumentRecord = {
      ...document,
      clauses,
      clauseCount: clauses.length,
      status: "ready",
      retrievalIndex: buildRetrievalIndex(toCoreClauses(clauses)),
    };
    storeDocument(analyzed);
    res.status(202).json(AnalyzeDocumentResponse.parse(toPublicDocument(analyzed)));
  } catch {
    res.status(500).json({ code: "ANALYSIS_FAILED", message: "Document analysis failed." });
  }
});

export default router;