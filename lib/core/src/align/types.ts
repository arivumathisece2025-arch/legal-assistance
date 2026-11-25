import { CLAUSE_TYPES, type ClauseType } from "../classify";

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