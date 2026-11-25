import { Router, type IRouter } from "express";
import {
  AskQuestionBody,
  GetDocumentParams,
  SimplifyDocumentBody,
  SimplifyDocumentResponse,
} from "@workspace/api-zod";
import { simplifyClauses } from "@workspace/core";
import { answerDocumentQuestion, answerProvider } from "./qa";
import { getAccessibleDocument } from "./store";

const router: IRouter = Router();

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

export default router;