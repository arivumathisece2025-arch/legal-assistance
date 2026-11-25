import { randomUUID } from "node:crypto";
import multer from "multer";
import { Router, type IRouter } from "express";
import { IngestionError, processUpload, buildRetrievalIndex } from "@workspace/core";
import { CreateDocumentBody, CreateDocumentResponse } from "@workspace/api-zod";
import { appendAuditLog, hashAuditIdentifier } from "../lib/auditLog";
import { encryptBlob, persistEncryptedDocument } from "./blobCrypto";
import { classifyDocumentPages } from "./qa";
import { storeDocument, toCoreClauses, toPublicDocument, type DocumentRecord } from "./store";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router: IRouter = Router();

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

export default router;