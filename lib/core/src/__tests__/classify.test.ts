import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { classifyClauses } from "../classify";
import type { Clause } from "../segment";
import type { LLMProvider } from "../llm/base";

const clauses: Clause[] = Array.from({ length: 200 }, (_, index) => ({
  id: `C${index + 1}`,
  ordinal: String(index + 1),
  heading: `Clause ${index + 1}`,
  text: `The parties agree to clause ${index + 1}.`,
  page: 1,
  charStart: index,
  charEnd: index + 1,
}));

test("batches classification into 25-clause provider calls", async () => {
  let calls = 0;
  const provider: LLMProvider = {
    async completeJson<T>(_system: string, user: string, schema: z.ZodType<T>): Promise<T> {
      calls += 1;
      const batch = JSON.parse(user) as Array<{ id: string }>;
      return schema.parse({ items: batch.map(({ id }) => ({ clauseId: id, type: "other" })) });
    },
  };

  const result = await classifyClauses(provider, clauses);
  assert.equal(calls, 8);
  assert.equal(result.length, 200);
  assert.deepEqual(result[0], { clauseId: "C1", type: "other" });
});