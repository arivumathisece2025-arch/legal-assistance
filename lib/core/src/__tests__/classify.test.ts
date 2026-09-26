import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { clearCache } from "../cache";
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

test("uses a content-hash cache so identical 25-clause batches call the provider once", async () => {
  clearCache();

  let calls = 0;
  const provider: LLMProvider = {
    async completeJson<T>(_system: string, user: string, schema: z.ZodType<T>): Promise<T> {
      calls += 1;
      const batch = JSON.parse(user) as Array<{ id: string }>;
      return schema.parse({ items: batch.map(({ id }) => ({ clauseId: id, type: "other" })) });
    },
  };

  const input = Array.from({ length: 25 }, (_, index) => ({
    id: `C${index + 1}`,
    ordinal: String(index + 1),
    heading: `Clause ${index + 1}`,
    text: `The parties agree to clause ${index + 1}.`,
    page: 1,
    charStart: index,
    charEnd: index + 1,
  }));

  const first = await classifyClauses(provider, input);
  const second = await classifyClauses(provider, input);

  assert.equal(calls, 1);
  assert.equal(first.length, 25);
  assert.equal(second.length, 25);
  assert.deepEqual(first[0], { clauseId: "C1", type: "other" });
});