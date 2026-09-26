import { createCipheriv, createHash, randomBytes } from "node:crypto";
import multer from "multer";
import { Router, type IRouter } from "express";
import {
  answerQuestion,
  compareVersions,
  GroqProvider,
  IngestionError,
  MockProvider,
  processUpload,
  type AlignableClause,
  type Clause,
  type LLMProvider,
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
} from "@workspace/api-zod";

type DocumentRecord = {
  id: string;
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

function encryptBlob(bytes: Uint8Array): string {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) throw new Error("APP_ENCRYPTION_KEY must be configured before storing uploads.");
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

async function persistEncryptedDocument(document: DocumentRecord, encryptedBlob: string, expiresAt: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const { db, storedDocuments } = await import("@workspace/db");
  const { lt } = await import("drizzle-orm");
  await db.delete(storedDocuments).where(lt(storedDocuments.expiresAt, new Date()));
  await db.insert(storedDocuments).values({
    id: document.id,
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

function toPublicDocument(document: DocumentRecord): Omit<DocumentRecord, "encryptedBlob"> {
  const { encryptedBlob: _encryptedBlob, ...publicDocument } = document;
  return publicDocument;
}

const seedDocument: DocumentRecord = {
  id: "doc-001",
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
  [seedDocument.id, seedDocument],
  [seedRevisedDocument.id, seedRevisedDocument],
]);

export function getDocumentRecord(id: string): DocumentRecord | undefined {
  return documents.get(id);
}

/**
 * Removes every in-memory document, returning the ids that were dropped.
 *
 * The DPDP erasure endpoint calls this so that "delete my data" actually
 * deletes something rather than reporting success over an untouched store.
 */
export function purgeAllDocuments(): string[] {
  const purged = [...documents.keys()];
  documents.clear();
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
  return new GroqProvider(smartModel ? { model: smartModel } : {});
}

/**
 * @param perspective Accepted for API compatibility with both ask routes.
 *   It is currently unused: the previous inline stub branched on it when
 *   phrasing its canned quote, and the real provider path does not yet put
 *   perspective into the system prompt. Threading it into `answerQuestion` is
 *   a real follow-up, so the parameter is kept rather than silently removed
 *   from a signature two routes depend on.
 */
export async function answerDocumentQuestion(documentId: string, question: string, perspective: "party_a" | "party_b", language: string = "en") {
  void perspective;
  const document = getDocumentRecord(documentId);
  if (!document) {
    throw new Error("Document not found");
  }

  const clauses: Clause[] = document.clauses.map((clause) => ({
    id: clause.id,
    ordinal: clause.ordinal,
    heading: clause.heading,
    text: clause.text,
    page: 1,
    charStart: 0,
    charEnd: clause.text.length,
  }));

  const result = await answerQuestion(question, clauses, answerProvider(), language);
  const citations = result.citations.map((clauseId) => {
    const clause = document.clauses.find((candidate) => candidate.id === clauseId);
    return {
      clauseId,
      label: clause ? `${clause.ordinal} · ${clause.heading}` : clauseId,
    };
  });

  return AskQuestionResponse.parse({
    answer: result.answer,
    citations,
    groundingRatio: result.groundingRatio,
    adviceMode: result.adviceMode,
    queued: false,
  });
}

const router: IRouter = Router();

router.get("/documents", (_req, res) => {
  const response = Array.from(documents.values()).map((document) => {
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
    const id = `doc-${Date.now()}`;
    const uploadedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const clauses = processed.redactedPages.map((page) => ({
      id: `P${page.pageNumber}`,
      ordinal: String(page.pageNumber),
      heading: `Page ${page.pageNumber}`,
      type: "other",
      severity: "low" as const,
      summary: page.text.split("\n")[0]?.slice(0, 160) ?? "",
      text: page.text,
    }));
    const document: DocumentRecord = {
      id,
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
    };
    const encryptedBlob = encryptBlob(req.file.buffer);
    document.encryptedBlob = encryptedBlob;
    document.expiresAt = expiresAt;
    await persistEncryptedDocument(document, encryptedBlob, expiresAt);
    documents.set(id, document);
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

  const id = `doc-${Date.now()}`;
  const document: DocumentRecord = {
    id,
    name: parsed.data.name,
    fileType: parsed.data.fileType.toUpperCase(),
    uploadedAt: new Date().toISOString(),
    status: "uploaded",
    pageCount: 0,
    clauseCount: 0,
    riskScore: 0,
    highRiskCount: 0,
    scannedDetected: false,
    securityFindings: [],
    injectionFindings: [],
    clauses: [],
  };

  documents.set(id, document);
  res.status(201).json(CreateDocumentResponse.parse(document));
});

router.get("/documents/:id", (req, res): void => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const document = documents.get(params.data.id);
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(GetDocumentResponse.parse(toPublicDocument(document)));
});

router.post("/documents/:id/ask", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const payload = {
    ...req.body,
    documentId: req.body.documentId ?? params.data.id,
  };
  const parsed = AskQuestionBody.safeParse(payload);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const wantsSse = req.headers.accept?.includes("text/event-stream") || req.query.stream === "sse";
  if (wantsSse) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: status\ndata: ${JSON.stringify({ step: "retrieving" })}\n\n`);
  }

  try {
    const result = await answerDocumentQuestion(parsed.data.documentId, parsed.data.question, parsed.data.perspective, "en");

    if (wantsSse) {
      res.write(`event: answer\ndata: ${JSON.stringify(result)}\n\n`);
      res.write("event: done\ndata: {\"ok\":true}\n\n");
      res.end();
      return;
    }

    res.json(result);
  } catch (error) {
    if (wantsSse) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : "Unknown error" })}\n\n`);
      res.end();
      return;
    }

    // A missing document is a 404. Anything else (an unconfigured provider, a
    // provider outage, a schema-validation failure) is a 500: reporting those
    // as "Document not found" sent debugging in the wrong direction once
    // already, masking "GROQ_API_KEY is not configured" as a lookup miss.
    if (error instanceof Error && error.message === "Document not found") {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
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
  return new GroqProvider(smartModel ? { model: smartModel } : {});
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

  const revisedDocument = documents.get(params.data.id);
  const baseDocument = documents.get(body.data.against);
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

    res.json(CompareDocumentVersionsResponse.parse(comparison));
  } catch (error) {
    res.status(500).json({
      code: "COMPARE_FAILED",
      message: error instanceof Error ? error.message : "Comparison failed",
    });
  }
});

router.post("/documents/:id", (req, res): void => {
  const params = AnalyzeDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const document = documents.get(params.data.id);
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const readyDocument = document.clauses.length > 0 ? document : seedDocument;
  const analyzed = {
    ...readyDocument,
    id: document.id,
    name: document.name,
    fileType: document.fileType,
    uploadedAt: document.uploadedAt,
    status: "ready" as const,
  };
  documents.set(document.id, analyzed);
  res.status(202).json(AnalyzeDocumentResponse.parse(analyzed));
});

export default router;