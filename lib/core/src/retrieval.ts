import type { Clause } from "./segment";

export type RetrievedClause = Clause & {
  score: number;
  matches: string[];
};

type IndexedClause = {
  clause: Clause;
  frequencies: Map<string, number>;
  length: number;
};

export type RetrievalIndex = {
  clauses: Clause[];
  entries: IndexedClause[];
  documentFrequency: Map<string, number>;
  averageLength: number;
};

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","if","then","what","when","where","why","how","who","which","for","with","from","into","onto","over","under","about","after","before","during","without","their","there","these","those","this","that","is","are","was","were","be","been","being","it","its","as","of","to","in","on","at","by","as","not","can","could","should","would","may","might","do","does","did","you","your","we","our","they","them","their","i","me","my","mine","he","she","him","her","his","hers","us","our","have","has","had","will","shall","about","through"],
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => stemToken(token.trim()))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function stemToken(token: string): string {
  if (token.endsWith("ments") && token.length > 7) return token.slice(0, -5);
  if (token.endsWith("ment") && token.length > 6) return token.slice(0, -4);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

export function buildRetrievalIndex(clauses: Clause[]): RetrievalIndex {
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;
  const entries = clauses.map((clause) => {
    const tokens = tokenize(`${clause.heading} ${clause.text}`);
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const token of frequencies.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    totalLength += tokens.length;
    return { clause, frequencies, length: tokens.length };
  });

  return {
    clauses,
    entries,
    documentFrequency,
    averageLength: clauses.length ? totalLength / clauses.length : 0,
  };
}

export function retrieveFromIndex(index: RetrievalIndex, question: string, limit = 6): RetrievedClause[] {
  const questionTokens = tokenize(question);
  if (!questionTokens.length) {
    return index.clauses.slice(0, limit).map((clause) => ({ ...clause, score: 0, matches: [] }));
  }

  const uniqueQuestionTokens = [...new Set(questionTokens)];
  const averageLength = index.averageLength || 1;
  return index.entries
    .map(({ clause, frequencies, length }, ordinal) => {
      let score = 0;
      const matches: string[] = [];
      for (const token of uniqueQuestionTokens) {
        const frequency = frequencies.get(token) ?? 0;
        if (!frequency) continue;
        matches.push(token);
        const documentFrequency = index.documentFrequency.get(token) ?? 0;
        const inverseDocumentFrequency = Math.log(1 + (index.entries.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const lengthNormalization = 1 - 0.75 + 0.75 * (length / averageLength);
        score += inverseDocumentFrequency * (frequency * (1.2 + 1)) / (frequency + 1.2 * lengthNormalization);
      }
      return { ...clause, score, matches, position: ordinal };
    })
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map(({ position: _position, ...clause }) => clause)
    .slice(0, limit);
}

export function retrieveClauses(clauses: Clause[], question: string, limit = 6): RetrievedClause[] {
  return retrieveFromIndex(buildRetrievalIndex(clauses), question, limit);
}
