import { Router, type IRouter } from "express";
import {
  AnalyzeDocumentParams,
  AnalyzeDocumentResponse,
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

const documents = new Map<string, DocumentRecord>([[seedDocument.id, seedDocument]]);

const router: IRouter = Router();

router.get("/documents", (_req, res) => {
  const response = Array.from(documents.values()).map(({ clauses: _clauses, ...document }) => document);
  res.json(ListDocumentsResponse.parse(response));
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

  res.json(GetDocumentResponse.parse(document));
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