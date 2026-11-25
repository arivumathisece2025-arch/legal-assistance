import { Router, type IRouter, type Request, type Response } from "express";
import {
  AskQuestionBody,
  GetDocumentParams,
  SimplifyDocumentBody,
  SimplifyDocumentResponse,
} from "@workspace/api-zod";
import { simplifyClauses } from "@workspace/core";
import { answerDocumentQuestion } from "./qa";
import { answerProvider } from "./providers";
import { getAccessibleDocument } from "./store";
import { closeSse, isSseRequest, openSse, sendSseEvent } from "../lib/sse";

const router: IRouter = Router();

export async function handleAskRequest(req: Request, res: Response, pathDocumentId?: string): Promise<void> {
  const params = pathDocumentId ? GetDocumentParams.safeParse({ id: pathDocumentId }) : undefined;
  if (params && !params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const documentId = params?.success ? params.data.id : undefined;
  const userId = req.session?.userId ?? "";
  if (documentId && !getAccessibleDocument(documentId, userId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const payload = documentId ? { ...req.body, documentId } : req.body;
  const parsed = AskQuestionBody.safeParse(payload);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const targetDocumentId = documentId ?? parsed.data.documentId;
  if (!documentId && !getAccessibleDocument(targetDocumentId, userId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const wantsSse = isSseRequest(req);
  const controller = wantsSse ? new AbortController() : undefined;
  const abortOnDisconnect = () => {
    if (controller && (req.aborted || (res.destroyed && !res.writableEnded))) controller.abort();
  };
  if (wantsSse) {
    req.on("close", abortOnDisconnect);
    res.on("close", abortOnDisconnect);
    openSse(res);
  }

  try {
    const result = await answerDocumentQuestion(
      targetDocumentId,
      userId,
      parsed.data.question,
      parsed.data.perspective,
      parsed.data.language ?? "en",
      wantsSse && controller
        ? {
          signal: controller.signal,
          onToken: (token: string) => {
            sendSseEvent(res, "token", { token });
          },
        }
        : undefined,
    );

    if (wantsSse) {
      sendSseEvent(res, "answer", result);
      sendSseEvent(res, "done", { ok: true });
      closeSse(res);
      return;
    }

    res.json(result);
  } catch (error) {
    if (wantsSse) {
      sendSseEvent(res, "error", { code: pathDocumentId ? "ASK_FAILED" : "QUESTION_FAILED", message: "Answer could not be generated." });
      closeSse(res);
      return;
    }

    if (pathDocumentId && error instanceof Error && error.message === "Document not found") {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.status(500).json({ code: pathDocumentId ? "ASK_FAILED" : "QUESTION_FAILED", message: "Answer could not be generated." });
  } finally {
    if (wantsSse) {
      req.off("close", abortOnDisconnect);
      res.off("close", abortOnDisconnect);
    }
  }
}

router.post("/documents/:id/ask", async (req, res): Promise<void> => {
  await handleAskRequest(req, res, req.params.id);
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

export default router;