import {
  answerQuestion,
  streamAnswerQuestion,
  classifyClauses,
  segmentDocument,
  type ParsedDocument,
} from "@workspace/core";
import { AskQuestionResponse } from "@workspace/api-zod";
import { appendAuditLog, hashAuditIdentifier } from "../lib/auditLog";
import { getAccessibleDocument, toCoreClauses, type DocumentRecord } from "./store";
import { answerProvider } from "./providers";

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