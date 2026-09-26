import { z } from "zod";
import { DEFAULT_LLM_MODEL, getCacheValue, hashCacheKey, setCacheValue } from "./cache";
import type { LLMProvider } from "./llm/base";

export const SIMPLIFY_PROMPT_VERSION = "simplify.v1";

export type SimplificationLanguage = "en" | "ta" | "hi";
export type SimplificationLevel = "as-written" | "plain" | "simple";

export type SimplifiedClause = {
  clauseId: string;
  level: SimplificationLevel;
  text: string;
  flagged: boolean;
  issues: string[];
};

const simplificationSchema = z.object({
  items: z.array(
    z.object({
      clauseId: z.string(),
      level: z.enum(["as-written", "plain", "simple"]),
      text: z.string(),
    }),
  ),
});

function normalizeLanguage(language: string | undefined): SimplificationLanguage {
  switch (language?.toLowerCase()) {
    case "ta":
    case "tamil":
      return "ta";
    case "hi":
    case "hindi":
      return "hi";
    case "en":
    case "english":
    default:
      return "en";
  }
}

function numericTokens(source: string): string[] {
  return Array.from(new Set((source.match(/\b\d+(?:[.,]\d+)*(?:%|st|nd|rd|th)?\b/g) ?? []).map((token) => token.replace(/[,]/g, ""))));
}

function dateTokens(source: string): string[] {
  return Array.from(
    new Set(
      (source.match(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/g) ?? []).map((token) => token.trim()),
    ),
  );
}

export function postCheckSimplification(sourceText: string, rewriteText: string): { flagged: boolean; issues: string[] } {
  const sourceNumbers = numericTokens(sourceText);
  const rewriteNumbers = numericTokens(rewriteText);
  const sourceDates = dateTokens(sourceText);
  const rewriteDates = dateTokens(rewriteText);

  const issues: string[] = [];

  const inventedNumbers = rewriteNumbers.filter((value) => !sourceNumbers.includes(value) && !sourceText.includes(value));
  const inventedDates = rewriteDates.filter((value) => !sourceDates.includes(value) && !sourceText.includes(value));

  if (inventedNumbers.length) {
    issues.push(`Invented numbers detected: ${inventedNumbers.join(", ")}`);
  }

  if (inventedDates.length) {
    issues.push(`Invented dates detected: ${inventedDates.join(", ")}`);
  }

  return {
    flagged: issues.length > 0,
    issues,
  };
}

export async function simplifyClauses<T extends { id: string; heading: string; text: string }>(
  clauses: T[],
  provider: LLMProvider,
  language: string = "en",
): Promise<SimplifiedClause[]> {
  if (!clauses.length) {
    return [];
  }

  const normalizedLanguage = normalizeLanguage(language);
  const payload = clauses.map((clause) => `Clause ${clause.id}: ${clause.heading}\n${clause.text}`).join("\n\n");
  const cacheKey = hashCacheKey(payload, DEFAULT_LLM_MODEL, `${SIMPLIFY_PROMPT_VERSION}:${normalizedLanguage}`);
  const cached = getCacheValue<SimplifiedClause[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const system = [
    "Rewrite each clause in the requested language without changing the legal meaning.",
    "Return the original clause id and the rewrite level exact values: as-written, plain, simple.",
    "Do not invent numbers, dates, or obligations that are not already stated in the clause.",
  ].join(" ");

  const user = [
    `Language: ${normalizedLanguage}`,
    "",
    payload,
    "",
    "Return JSON with a top-level items array.",
  ].join("\n");

  const response = await provider.completeJson(system, user, simplificationSchema);

  const items = response.items.map((item) => {
    const source = clauses.find((clause) => clause.id === item.clauseId);
    const validation = source ? postCheckSimplification(source.text, item.text) : { flagged: false, issues: [] };

    return {
      clauseId: item.clauseId,
      level: item.level,
      text: item.text,
      flagged: validation.flagged,
      issues: validation.issues,
    } satisfies SimplifiedClause;
  });

  setCacheValue(cacheKey, items);
  return items;
}

export async function simplifyClause(
  clause: { id: string; heading: string; text: string },
  provider: LLMProvider,
  language: string = "en",
): Promise<SimplifiedClause[]> {
  return simplifyClauses([clause], provider, language);
}