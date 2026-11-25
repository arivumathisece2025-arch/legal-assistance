import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestion, streamAnswerQuestion } from "../answer";
import { clearCache } from "../cache";
import type { LLMProvider } from "../llm/base";
import type { Clause } from "../segment";

const clauses: Clause[] = [
  {
    id: "C1",
    ordinal: "1",
    heading: "Payment",
    text: "The customer must pay the invoice within thirty days.",
    page: 1,
    charStart: 0,
    charEnd: 54,
  },
];

function providerFor(onCall: () => void, modelLabel = "test-model"): LLMProvider {
  return {
    modelLabel,
    async completeJson<T>(_system: string, _user: string, schema: { parse(value: unknown): T }): Promise<T> {
      onCall();
      return schema.parse({ answer: "The customer must pay within thirty days." });
    },
  } as LLMProvider;
}

test("answerQuestion caches a repeated normalized question for the same document", async () => {
  clearCache();
  let calls = 0;
  const provider = providerFor(() => { calls += 1; });
  const options = { cacheScope: "doc-a", perspective: "party_a" };

  await answerQuestion("  WHEN is payment due?  ", clauses, provider, "en", options);
  await answerQuestion("when   is payment due?", clauses, provider, "en", options);

  assert.equal(calls, 1);
});

test("answer cache separates question, document, language, perspective, and model", async () => {
  clearCache();
  let calls = 0;
  const provider = providerFor(() => { calls += 1; });

  await answerQuestion("When is payment due?", clauses, provider, "en", { cacheScope: "doc-a", perspective: "party_a" });
  await answerQuestion("What is the payment deadline?", clauses, provider, "en", { cacheScope: "doc-a", perspective: "party_a" });
  await answerQuestion("When is payment due?", clauses, provider, "en", { cacheScope: "doc-b", perspective: "party_a" });
  await answerQuestion("When is payment due?", clauses, provider, "hi", { cacheScope: "doc-a", perspective: "party_a" });
  await answerQuestion("When is payment due?", clauses, provider, "en", { cacheScope: "doc-a", perspective: "party_b" });
  await answerQuestion("When is payment due?", clauses, providerFor(() => { calls += 1; }, "other-model"), "en", { cacheScope: "doc-a", perspective: "party_a" });

  assert.equal(calls, 6);
});

test("provider failures are not cached", async () => {
  clearCache();
  let calls = 0;
  const provider: LLMProvider = {
    async completeJson<T>(_system: string, _user: string, schema: { parse(value: unknown): T }): Promise<T> {
      calls += 1;
      if (calls === 1) throw new Error("provider failed");
      return schema.parse({ answer: "The customer must pay within thirty days." });
    },
  };

  await assert.rejects(answerQuestion("When is payment due?", clauses, provider, "en", { cacheScope: "doc-a" }), /provider failed/);
  await answerQuestion("When is payment due?", clauses, provider, "en", { cacheScope: "doc-a" });

  assert.equal(calls, 2);
});

test("streamed answers emit provider tokens and verify citations after the full response", async () => {
  clearCache();
  const tokens: string[] = [];
  const provider: LLMProvider = {
    modelLabel: "stream-model",
    async completeJson<T>(): Promise<T> {
      throw new Error("completeJson must not be used by a streaming provider");
    },
    async completeText(_system, _user, onToken): Promise<string> {
      await onToken("The customer ");
      await onToken("must pay within thirty days. [C1]");
      return "The customer must pay within thirty days. [C1]";
    },
  };

  const result = await streamAnswerQuestion(
    "When is payment due?",
    clauses,
    provider,
    "en",
    { cacheScope: "stream-doc" },
    (token) => { tokens.push(token); },
  );

  assert.deepEqual(tokens, ["The customer ", "must pay within thirty days. [C1]"]);
  assert.equal(result.citations[0], "C1");
  assert.ok(result.groundingRatio > 0);
});