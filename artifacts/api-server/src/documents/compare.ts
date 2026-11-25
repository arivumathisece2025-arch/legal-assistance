import { Router, type IRouter } from "express";
import { compareVersions, type AlignableClause } from "@workspace/core";
import {
  CompareDocumentVersionsBody,
  CompareDocumentVersionsParams,
  CompareDocumentVersionsResponse,
} from "@workspace/api-zod";
import { appendAuditLog, hashAuditIdentifier } from "../lib/auditLog";
import { getAccessibleDocument, type DocumentRecord } from "./store";
import { versionDiffProvider } from "./providers";

const router: IRouter = Router();

function toComparableClause(clause: DocumentRecord["clauses"][number]): AlignableClause {
  return {
    id: clause.id,
    ordinal: clause.ordinal,
    heading: clause.heading,
    text: clause.text,
    type: clause.type,
  };
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

export default router;