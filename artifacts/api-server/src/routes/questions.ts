import { Router, type IRouter } from "express";
import { AskQuestionBody, AskQuestionResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/questions", (req, res): void => {
  const parsed = AskQuestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const isAdviceQuestion = /\b(should i|will i|can they sue|what should i)\b/i.test(
    parsed.data.question,
  );
  const answer = isAdviceQuestion
    ? "I can explain what the document says, but I cannot decide whether you should sign it or predict a legal outcome. The document gives the other party a broad indemnity in [C7] and one-sided convenience termination rights in [C12]. Ask a lawyer whether those provisions match your risk tolerance and negotiating position."
    : "The document states that the client may terminate for convenience with thirty (30) days' written notice, while the provider does not have the same convenience termination right. That appears in [C12].";

  res.json(
    AskQuestionResponse.parse({
      answer,
      citations: [
        { clauseId: "C12", label: "Clause 12 · Termination" },
        ...(isAdviceQuestion ? [{ clauseId: "C7", label: "Clause 7 · Indemnification" }] : []),
      ],
      groundingRatio: 1,
      adviceMode: isAdviceQuestion,
      queued: false,
    }),
  );
});

export default router;