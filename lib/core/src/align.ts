import { CLAUSE_TYPES, type ClauseType } from "./classify";

/**
 * Pure clause alignment for version comparison.
 *
 * Two clause lists are aligned with a score built from three signals:
 *   1. heading similarity (normalized heading equality plus token overlap),
 *   2. clause-type match (declared type, falling back to heading keywords),
 *   3. token-set (Jaccard) similarity over heading + body.
 *
 * Candidates are ranked and assigned greedily, so every clause is used at most
 * once. Pairs below `minMatchScore` stay unmatched and surface as added or
 * removed clauses. Matched pairs below `threshold` are flagged `changed`.
 *
 * This module performs no I/O and calls no model: it is safe to run in any
 * process, including the browser bundle.
 */

export type AlignableClause = {
  id: string;
  heading: string;
  text: string;
  ordinal?: string;
  type?: string;
};

export type SimilarityWeights = {
  heading: number;
  clauseType: number;
  tokens: number;
};

export type SimilarityBreakdown = {
  headingSimilarity: number;
  clauseTypeMatch: number;
  tokenSimilarity: number;
};

export type AlignedClausePair = {
  /** Stable identity for the pair: `${before.id}~${after.id}`. */
  key: string;
  before: AlignableClause;
  after: AlignableClause;
  beforeIndex: number;
  afterIndex: number;
  similarity: number;
  /** True when the pair scores below the change threshold or moved a number. */
  changed: boolean;
  breakdown: SimilarityBreakdown;
  beforeType: ClauseType;
  afterType: ClauseType;
  /** A number that exists on one side and not the other (30 days vs 90 days). */
  numericChange: boolean;
};

export type ClauseAlignment = {
  pairs: AlignedClausePair[];
  /** Clauses that exist only in the revised version. */
  added: AlignableClause[];
  /** Clauses that exist only in the base version. */
  removed: AlignableClause[];
  scoreMatrix: number[][];
  threshold: number;
  minMatchScore: number;
  weights: SimilarityWeights;
};

export type AlignOptions = {
  /** Matched pairs scoring below this are reported as changed. Default 0.9. */
  threshold?: number;
  /** Candidate pairs scoring below this are not matched at all. Default 0.3. */
  minMatchScore?: number;
  weights?: Partial<SimilarityWeights>;
  stopWords?: ReadonlySet<string>;
};

export const DEFAULT_SIMILARITY_WEIGHTS: SimilarityWeights = {
  heading: 0.35,
  clauseType: 0.25,
  tokens: 0.4,
};

export const DEFAULT_CHANGE_THRESHOLD = 0.9;
export const DEFAULT_MIN_MATCH_SCORE = 0.3;

/** Boilerplate words carry no clause identity, so they are dropped from tokens. */
export const DEFAULT_STOP_WORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "by",
  "shall",
  "will",
  "may",
  "must",
  "is",
  "are",
  "be",
  "as",
  "at",
  "from",
  "it",
  "its",
  "such",
  "any",
  "all",
  "this",
  "that",
  "these",
  "those",
  "hereby",
  "herein",
  "hereof",
  "thereto",
]);

const CLAUSE_TYPE_HINTS: ReadonlyArray<readonly [ClauseType, RegExp]> = [
  ["non_compete", /non[- ]?compete|restrictive covenant/i],
  ["liability_cap", /liability|limitation of liability/i],
  ["indemnity", /indemn/i],
  ["arbitration", /arbit/i],
  ["force_majeure", /force majeure|act of god/i],
  ["auto_renewal", /auto[- ]?renew|renewal/i],
  ["confidentiality", /confidential|non[- ]?disclosure/i],
  ["data_privacy", /privacy|personal data|data (?:processing|protection|sharing)|data\b/i],
  ["jurisdiction", /governing law|jurisdiction|dispute resolution|courts?/i],
  ["termination", /terminat/i],
  ["payment", /payment|invoice|fees|remuneration|charges/i],
  ["ip_ownership", /intellectual property|\bip\b|ownership|inventions/i],
  ["assignment", /assign/i],
  ["warranty", /warrant|representation/i],
];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isClauseType(value: string): value is ClauseType {
  return (CLAUSE_TYPES as readonly string[]).includes(value);
}

/** Declared type when it is one of the known clause types, else inferred from the heading. */
export function resolveClauseType(clause: AlignableClause): ClauseType {
  if (typeof clause.type === "string" && isClauseType(clause.type)) {
    return clause.type;
  }

  for (const [type, pattern] of CLAUSE_TYPE_HINTS) {
    if (pattern.test(clause.heading)) {
      return type;
    }
  }

  return "other";
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
