export type AdviceGateResult = {
  adviceMode: boolean;
  reframedQuestion: string;
  reason: string;
};

const ADVICE_PATTERNS = [
  /should i (?:sign|accept|agree to|enter into)/i,
  /should we (?:sign|accept|agree to|enter into)/i,
  /can they sue/i,
  /will i be liable/i,
  /am i exposed/i,
  /what should i do/i,
  /should .* be in this contract/i,
];

export function classifyAdviceQuestion(question: string): AdviceGateResult {
  const normalized = question.trim();
  const adviceMode = ADVICE_PATTERNS.some((pattern) => pattern.test(normalized));

  if (!adviceMode) {
    return {
      adviceMode: false,
      reframedQuestion: normalized,
      reason: "This is an information question rather than a request for legal advice.",
    };
  }

  const cleaned = normalized
    .replace(/^(?:should|can|will|am)\s+/i, "")
    .replace(/\b(i|we)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    adviceMode: true,
    reframedQuestion: `What does the document say about ${cleaned || "the key contract terms"}?`,
    reason: "The request asks for a recommendation rather than document-grounded explanation.",
  };
}
