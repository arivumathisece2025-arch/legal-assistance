import { z } from "zod";
import type { LLMProvider } from "./llm/base";
import type { Clause } from "./segment";

export const obligationSchema = z.object({
  obligations: z.array(
    z.object({
      party: z.enum(["partyA", "partyB"]).default("partyA"),
      who: z.string(),
      what: z.string(),
      due: z.string(),
      sourceClauseId: z.string(),
    }),
  ),
});

export type ObligationParty = "partyA" | "partyB";

export type Obligation = {
  party: ObligationParty;
  who: string;
  what: string;
  due: string;
  dueDate?: string;
  sourceClauseId: string;
};

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function resolveRelativeDate(deadlineText: string, effectiveDate: Date = new Date()): { due: string; dueDate?: string } {
  const trimmed = deadlineText.trim();
  const match = trimmed.match(/(\d+)\s+(day|days|month|months|year|years)/i);
  if (!match) {
    return { due: trimmed };
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const target = new Date(effectiveDate);

  if (unit.startsWith("day")) {
    target.setDate(target.getDate() + amount);
  } else if (unit.startsWith("month")) {
    target.setMonth(target.getMonth() + amount);
  } else if (unit.startsWith("year")) {
    target.setFullYear(target.getFullYear() + amount);
  }

  return { due: trimmed, dueDate: toIsoDate(target) };
}

export async function extractObligations(
  clauses: Clause[],
  provider: LLMProvider,
  effectiveDate: Date = new Date(),
): Promise<Obligation[]> {
  const system = "Extract contractual obligations as JSON. Use the clause ids and infer only from the document text.";
  const user = clauses
    .map((clause) => `Clause ${clause.id}: ${clause.heading}\n${clause.text}`)
    .join("\n\n");

  const response = await provider.completeJson(system, user, obligationSchema);

  return response.obligations.map((obligation) => {
    const resolved = resolveRelativeDate(obligation.due, effectiveDate);
    const party: ObligationParty = obligation.party ?? "partyA";
    return {
      party,
      who: obligation.who,
      what: obligation.what,
      due: resolved.due,
      dueDate: resolved.dueDate,
      sourceClauseId: obligation.sourceClauseId,
    };
  });
}
