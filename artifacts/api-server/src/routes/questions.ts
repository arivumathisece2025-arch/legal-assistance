import { Router, type IRouter } from "express";
import { AskQuestionBody } from "@workspace/api-zod";
import { answerDocumentQuestion, getAccessibleDocument } from "./documents";

const router: IRouter = Router();

router.post("/questions", async (req, res): Promise<void> => {
  const parsed = AskQuestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.session!.userId;
  if (!getAccessibleDocument(parsed.data.documentId, userId)) {
    res.status(404).json({ error: "Document not found" });
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
      userId,
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
        res.write(`event: error\ndata: ${JSON.stringify({ code: "QUESTION_FAILED", message: "Answer could not be generated." })}\n\n`);
        res.end();
      }
      return;
    }

    res.status(500).json({ code: "QUESTION_FAILED", message: "Answer could not be generated." });
  } finally {
    if (wantsSse) {
      req.off("close", abortOnDisconnect);
      res.off("close", abortOnDisconnect);
    }
  }
});

export default router;