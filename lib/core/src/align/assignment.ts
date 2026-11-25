import {
  DEFAULT_CHANGE_THRESHOLD,
  DEFAULT_MIN_MATCH_SCORE,
  DEFAULT_SIMILARITY_WEIGHTS,
  resolveClauseType,
  type AlignOptions,
  type AlignableClause,
  type AlignedClausePair,
  type ClauseAlignment,
  type SimilarityWeights,
} from "./types";
import { buildScoreMatrix, clauseSimilarity, numericTokensDiffer } from "./similarity";

export type GreedyMatch = {
  beforeIndex: number;
  afterIndex: number;
  score: number;
};

/**
 * Greedy one-to-one assignment over the score matrix. Highest scoring candidate
 * wins first; ties break on document order so the result is deterministic and
 * no base or revised clause is ever used twice.
 */
export function greedyAssign(scores: number[][], minMatchScore: number = DEFAULT_MIN_MATCH_SCORE): GreedyMatch[] {
  const candidates: GreedyMatch[] = [];
  scores.forEach((row, beforeIndex) => {
    row.forEach((score, afterIndex) => {
      if (score >= minMatchScore) candidates.push({ beforeIndex, afterIndex, score });
    });
  });

  candidates.sort(
    (left, right) =>
      right.score - left.score || left.beforeIndex - right.beforeIndex || left.afterIndex - right.afterIndex,
  );

  const takenBefore = new Set<number>();
  const takenAfter = new Set<number>();
  const matches: GreedyMatch[] = [];

  for (const candidate of candidates) {
    if (takenBefore.has(candidate.beforeIndex) || takenAfter.has(candidate.afterIndex)) continue;
    takenBefore.add(candidate.beforeIndex);
    takenAfter.add(candidate.afterIndex);
    matches.push(candidate);
  }

  return matches;
}

export function alignClauses(
  before: AlignableClause[],
  after: AlignableClause[],
  options: AlignOptions = {},
): ClauseAlignment {
  const weights: SimilarityWeights = { ...DEFAULT_SIMILARITY_WEIGHTS, ...options.weights };
  const threshold = options.threshold ?? DEFAULT_CHANGE_THRESHOLD;
  const minMatchScore = options.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE;
  const scoreMatrix = buildScoreMatrix(before, after, weights, options.stopWords);
  const matches = greedyAssign(scoreMatrix, minMatchScore);

  const pairs: AlignedClausePair[] = matches
    .map((match) => {
      const beforeClause = before[match.beforeIndex];
      const afterClause = after[match.afterIndex];
      const { similarity, breakdown } = clauseSimilarity(beforeClause, afterClause, weights, options.stopWords);
      const numericChange = numericTokensDiffer(
        `${beforeClause.heading} ${beforeClause.text}`,
        `${afterClause.heading} ${afterClause.text}`,
      );

      return {
        key: `${beforeClause.id}~${afterClause.id}`,
        before: beforeClause,
        after: afterClause,
        beforeIndex: match.beforeIndex,
        afterIndex: match.afterIndex,
        similarity,
        changed: similarity < threshold || numericChange,
        breakdown,
        beforeType: resolveClauseType(beforeClause),
        afterType: resolveClauseType(afterClause),
        numericChange,
      } satisfies AlignedClausePair;
    })
    .sort((left, right) => left.afterIndex - right.afterIndex || left.beforeIndex - right.beforeIndex);

  const matchedBefore = new Set(pairs.map((pair) => pair.beforeIndex));
  const matchedAfter = new Set(pairs.map((pair) => pair.afterIndex));

  return {
    pairs,
    added: after.filter((_clause, index) => !matchedAfter.has(index)),
    removed: before.filter((_clause, index) => !matchedBefore.has(index)),
    scoreMatrix,
    threshold,
    minMatchScore,
    weights,
  };
}