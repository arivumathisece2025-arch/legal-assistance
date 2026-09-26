import { z } from "zod";
import { CLASSIFICATION_PROMPT_VERSION, DEFAULT_LLM_MODEL, getCacheValue, hashCacheKey, setCacheValue } from "./cache";
import type { Clause } from "./segment";
import type { LLMProvider } from "./llm/base";

export const CLAUSE_TYPES = [
  "payment",
  "termination",
  "indemnity",
  "liability_cap",
  "confidentiality",
  "ip_ownership",
  "non_compete",
  "arbitration",
  "jurisdiction",
  "auto_renewal",
  "data_privacy",
  "force_majeure",
  "assignment",
  "warranty",
  "other",
] as const;

export type ClauseType = (typeof CLAUSE_TYPES)[number];

export type ClauseClassification = {
  clauseId: string;
  type: ClauseType;
};

const classificationSchema = z.object({
  items: z.array(z.object({
    clauseId: z.string(),
    type: z.enum(CLAUSE_TYPES),
  })),
}).describe("clause-classification");

const BATCH_SIZE = 25;

export async function classifyClauses(provider: LLMProvider, clauses: Clause[]): Promise<ClauseClassification[]> {
  const classifications: ClauseClassification[] = [];
  for (let start = 0; start < clauses.length; start += BATCH_SIZE) {
    const batch = clauses.slice(start, start + BATCH_SIZE);
    const normalizedInput = JSON.stringify(
      batch.map((clause) => ({ id: clause.id, heading: clause.heading, text: clause.text })),
    );
    const cacheKey = hashCacheKey(normalizedInput, DEFAULT_LLM_MODEL, CLASSIFICATION_PROMPT_VERSION);
    const cachedResult = getCacheValue<ClauseClassification[]>(cacheKey);

    if (cachedResult) {
      classifications.push(...cachedResult);
      continue;
    }

    const result = await provider.completeJson(
      "Classify each contract clause into exactly one of the permitted clause types.",
      normalizedInput,
      classificationSchema,
    );
    const parsed = result.items.map(({ clauseId, type }) => ({ clauseId, type }));
    setCacheValue(cacheKey, parsed);
    classifications.push(...parsed);
  }
  return classifications;
}