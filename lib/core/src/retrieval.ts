import type { Clause } from "./segment";

export type RetrievedClause = Clause & {
  score: number;
  matches: string[];
};

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","if","then","what","when","where","why","how","who","which","for","with","from","into","onto","over","under","about","after","before","during","without","their","there","these","those","this","that","is","are","was","were","be","been","being","it","its","as","of","to","in","on","at","by","as","not","can","could","should","would","may","might","do","does","did","you","your","we","our","they","them","their","i","me","my","mine","he","she","him","her","his","hers","us","our","have","has","had","will","shall","about","through"],
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function scoreClause(clause: Clause, questionTokens: string[], clauseTokens: string[]): number {
  const clauseText = `${clause.heading} ${clause.text}`.toLowerCase();
  const matches = questionTokens.filter((token) => clauseText.includes(token));
  const uniqueMatches = [...new Set(matches)];
  const tokenFrequency = clauseTokens.reduce<Record<string, number>>((acc, token) => {
    acc[token] = (acc[token] ?? 0) + 1;
    return acc;
  }, {});

  const bm25 = questionTokens.reduce((total, token) => {
    const frequency = tokenFrequency[token] ?? 0;
    return total + (frequency * 2.2) / (frequency + 1.2 + 0.6 * Math.max(0, clauseTokens.length / 40));
  }, 0);

  return bm25 + uniqueMatches.length * 4.5;
}

export function retrieveClauses(clauses: Clause[], question: string, limit = 6): RetrievedClause[] {
  const questionTokens = tokenize(question);
  if (!questionTokens.length) {
    return clauses.slice(0, limit).map((clause) => ({ ...clause, score: 0, matches: [] }));
  }

  return clauses
    .map((clause) => {
      const clauseTokens = tokenize(`${clause.heading} ${clause.text}`);
      const score = scoreClause(clause, questionTokens, clauseTokens);
      const matches = questionTokens.filter((token) => `${clause.heading} ${clause.text}`.toLowerCase().includes(token));
      return { ...clause, score, matches: [...new Set(matches)] };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
