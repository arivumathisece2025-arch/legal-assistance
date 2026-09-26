import type { Clause } from "./segment";

export type VerifiedAnswer = {
  answer: string;
  groundingRatio: number;
  citations: string[];
};

const CITATION_RE = /\[([A-Za-z0-9][A-Za-z0-9.-]*)\]/gi;
const QUOTED_TEXT_RE = /["'“”‘’]([^"'“”‘’]+)["'“”‘’]/g;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

export function verifyGroundedAnswer(answer: string, clauses: Clause[]): VerifiedAnswer {
  const clauseMap = new Map(clauses.map((clause) => [clause.id, clause]));
  const referenced = [...new Set(Array.from(answer.matchAll(CITATION_RE), (match) => match[1]))];
  const validCitations = referenced.filter((citation) => clauseMap.has(citation));

  const validQuoteCheck = (sentence: string): boolean => {
    const sentenceCitations = Array.from(sentence.matchAll(CITATION_RE), (match) => match[1]);
    if (sentenceCitations.some((citation) => !clauseMap.has(citation))) {
      return false;
    }

    const quotes = Array.from(sentence.matchAll(QUOTED_TEXT_RE), (match) => match[1]);
    for (const quote of quotes) {
      const clause = sentenceCitations.length ? clauseMap.get(sentenceCitations[0]!) : null;
      if (!clause) continue;
      const normalizedQuote = quote.trim();
      if (normalizedQuote.length > 0 && !clause.text.includes(normalizedQuote)) {
        return false;
      }
    }

    return true;
  };

  const filteredSentences = splitSentences(answer)
    .filter((sentence) => validQuoteCheck(sentence))
    .filter((sentence) => !/\[[A-Za-z0-9][A-Za-z0-9.-]*\]/i.test(sentence) || Array.from(sentence.matchAll(CITATION_RE), (match) => match[1]).every((citation) => clauseMap.has(citation)));

  const cleanedAnswer = filteredSentences.join(" ").trim();
  const groundingRatio = referenced.length === 0 ? 1 : validCitations.length / referenced.length;

  return {
    answer: cleanedAnswer,
    groundingRatio,
    citations: validCitations,
  };
}
