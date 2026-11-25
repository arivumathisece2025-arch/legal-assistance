import {
  answerQuestion,
  streamAnswerQuestion,
  GroqProvider,
  MockProvider,
  classifyClauses,
  segmentDocument,
  type LLMProvider,
  type ParsedDocument,
} from "@workspace/core";
import { AskQuestionResponse } from "@workspace/api-zod";
import { createLogger } from "../lib/secureLogger";
import { appendAuditLog, hashAuditIdentifier } from "../lib/auditLog";
import { getAccessibleDocument, toCoreClauses, type DocumentRecord } from "./store";

const secureLogger = createLogger("api-server");

function groqProvider(model?: string): GroqProvider {
  return new GroqProvider({
    ...(model ? { model } : {}),
    onUpstreamError: (status, upstreamBody) => {
      secureLogger.error("LLM upstream request failed", { status, body: upstreamBody });
    },
  });
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
export function answerProvider(): LLMProvider {
  if (process.env.MOCK_LLM === "1") {
    return new MockProvider();
  }

  const smartModel = process.env.GROQ_MODEL_SMART ?? process.env.GROQ_MODEL_FAST;
  return groqProvider(smartModel);
}

export async function classifyDocumentPages(pages: ParsedDocument["pages"]): Promise<DocumentRecord["clauses"]> {
  const parsed: ParsedDocument = { pageCount: pages.length, pages, headings: [], isScanned: false };
  const clauses = segmentDocument(parsed);
  if (!clauses.length) return [];

  const classifications = await classifyClauses(answerProvider(), clauses);
  const byId = new Map(classifications.map((classification) => [classification.clauseId, classification]));
  return clauses.map((clause) => {
    const classification = byId.get(clause.id);
    return {
      id: clause.id,
      ordinal: clause.ordinal,
      heading: clause.heading,
      type: classification?.type ?? "other",
      severity: classification?.severity ?? "low",
      summary: classification?.summary || clause.text.split(/[.!?]/)[0]?.slice(0, 160) || clause.heading,
      text: clause.text,
    };
  });
}

/**
 * Perspective participates in answer caching so the same question can be
 * prepared independently for either party.
 */
export async function answerDocumentQuestion(
  documentId: string,
  userId: string,
  question: string,
  perspective: "party_a" | "party_b",
  language: string = "en",
  stream?: { onToken: (token: string) => void; signal: AbortSignal },
) {
  const document = getAccessibleDocument(documentId, userId);
  if (!document) {
    throw new Error("Document not found");
  }

  const clauses = document.retrievalIndex?.clauses ?? toCoreClauses(document.clauses);

  const provider = answerProvider();
  const answerOptions = {
    retrievalIndex: document.retrievalIndex,
    cacheScope: document.id,
    perspective,
  };
  const result = stream
    ? await streamAnswerQuestion(question, clauses, provider, language, answerOptions, stream.onToken, stream.signal)
    : await answerQuestion(question, clauses, provider, language, answerOptions);
  const citations = result.citations.map((clauseId) => {
    const clause = document.clauses.find((candidate) => candidate.id === clauseId);
    return {
      clauseId,
      label: clause ? `${clause.ordinal} · ${clause.heading}` : clauseId,
    };
  });

  const response = AskQuestionResponse.parse({
    answer: result.answer,
    citations,
    groundingRatio: result.groundingRatio,
    adviceMode: result.adviceMode,
    queued: false,
  });
  appendAuditLog("DOCUMENT_ASK", userId, { documentIdHash: hashAuditIdentifier(document.id) });
  return response;
}