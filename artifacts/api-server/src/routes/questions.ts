import { Router, type IRouter } from "express";
import { AskQuestionBody } from "@workspace/api-zod";
import { answerDocumentQuestion } from "./documents";

const router: IRouter = Router();

router.post("/questions", async (req, res): Promise<void> => {
  const parsed = AskQuestionBody.safeParse(req.body);
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

    res.status(404).json({ error: "Document not found" });
  }
});

export default router;