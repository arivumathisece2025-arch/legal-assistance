import { Router, type IRouter } from "express";
import { buildRetrievalIndex } from "@workspace/core";
import {
  AnalyzeDocumentParams,
  AnalyzeDocumentResponse,
  GetDocumentParams,
  GetDocumentResponse,
  ListDocumentsResponse,
} from "@workspace/api-zod";
import { appendAuditLog, hashAuditIdentifier } from "../lib/auditLog";
import { classifyDocumentPages } from "./qa";
import { documents, getAccessibleDocument, storeDocument, toCoreClauses, toPublicDocument, type DocumentRecord } from "./store";

const router: IRouter = Router();

router.get("/documents", (req, res) => {
  const userId = req.session?.userId ?? "";
  const response = Array.from(documents.values())
    .filter((document) => document.ownerId === "public" || document.ownerId === userId)
    .map((document) => {
      const { clauses, ...summary } = toPublicDocument(document);
      void clauses;
      return summary;
    });
  res.json(ListDocumentsResponse.parse(response));
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