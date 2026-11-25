import type { ClauseType } from "../classify";
import {
  DEFAULT_SIMILARITY_WEIGHTS,
  DEFAULT_STOP_WORDS,
  resolveClauseType,
  type AlignableClause,
  type SimilarityBreakdown,
  type SimilarityWeights,
} from "./types";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function tokenSet(text: string, stopWords: ReadonlySet<string> = DEFAULT_STOP_WORDS): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/g) ?? [];
  const set = new Set<string>();
  for (const token of tokens) {
    const cleaned = token.replace(/^[.-]+|[.-]+$/g, "");
    if (cleaned.length < 2 || stopWords.has(cleaned)) continue;
    set.add(cleaned);
  }
  return set;
}

export function jaccardTokens(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : round(intersection / union);
}

export function jaccardSimilarity(left: string, right: string, stopWords?: ReadonlySet<string>): number {
  return jaccardTokens(tokenSet(left, stopWords), tokenSet(right, stopWords));
}

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function headingSimilarity(left: string, right: string, stopWords?: ReadonlySet<string>): number {
  const normalizedLeft = normalizeHeading(left);
  const normalizedRight = normalizeHeading(right);

  if (!normalizedLeft && !normalizedRight) return 1;
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const overlap = jaccardSimilarity(left, right, stopWords);
  const contained = normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
  return round(clamp01(Math.max(overlap, contained ? 0.85 : 0)));
}

/**
 * 1 when both clauses carry the same type, partial credit when a type is unknown
 * ("other") because the text signals then have to do the work, else 0.
 */
export function clauseTypeMatch(left: ClauseType, right: ClauseType): number {
  if (left === right) return 1;
  if (left === "other" || right === "other") return 0.25;
  return 0;
}

export function numericTokens(text: string): Set<string> {
  const matches = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return new Set(matches.map((value) => value.replace(/,/g, "")));
}

/** True when a figure changed (30 days -> 90 days) even if the wording did not. */
export function numericTokensDiffer(left: string, right: string): boolean {
  const leftTokens = numericTokens(left);
  const rightTokens = numericTokens(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return false;
  if (leftTokens.size !== rightTokens.size) return true;

  for (const token of leftTokens) {
    if (!rightTokens.has(token)) return true;
  }
  return false;
}

export function clauseSimilarity(
  left: AlignableClause,
  right: AlignableClause,
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS,
  stopWords?: ReadonlySet<string>,
): { similarity: number; breakdown: SimilarityBreakdown } {
  const breakdown: SimilarityBreakdown = {
    headingSimilarity: headingSimilarity(left.heading, right.heading, stopWords),
    clauseTypeMatch: clauseTypeMatch(resolveClauseType(left), resolveClauseType(right)),
    tokenSimilarity: jaccardSimilarity(`${left.heading} ${left.text}`, `${right.heading} ${right.text}`, stopWords),
  };

  const total = weights.heading + weights.clauseType + weights.tokens || 1;
  const similarity = round(
    clamp01(
      (breakdown.headingSimilarity * weights.heading +
        breakdown.clauseTypeMatch * weights.clauseType +
        breakdown.tokenSimilarity * weights.tokens) /
        total,
    ),
  );

  return { similarity, breakdown };
}

export function buildScoreMatrix(
  before: AlignableClause[],
  after: AlignableClause[],
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS,
  stopWords?: ReadonlySet<string>,
): number[][] {
  return before.map((left) => after.map((right) => clauseSimilarity(left, right, weights, stopWords).similarity));
}