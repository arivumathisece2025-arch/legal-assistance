import assert from "node:assert/strict";
import test from "node:test";
import { classifyAdviceQuestion } from "../adviceGate";
import { answerQuestion } from "../answer";
import { retrieveClauses } from "../retrieval";
import { verifyGroundedAnswer } from "../verify";

const clauses = [
  {
    id: "C1",
    ordinal: "1",
    heading: "Termination",
    text: "The client may terminate for convenience on 30 days' written notice.",
    page: 1,
    charStart: 0,
    charEnd: 100,
  },
  {
    id: "C2",
    ordinal: "2",
    heading: "Indemnity",
    text: "The supplier shall indemnify the client without cap for all losses arising from services.",
    page: 1,
    charStart: 101,
    charEnd: 220,
  },
  {
    id: "C3",
    ordinal: "3",
    heading: "Payment",
    text: "Invoices are payable within 90 days of receipt.",
    page: 1,
    charStart: 221,
    charEnd: 280,
  },
];

test("retrieval ranks termination clauses highest for termination questions", () => {
  const results = retrieveClauses(clauses, "What happens if I end this early?");
  assert.equal(results[0]?.id, "C1");
  assert.ok(results.length >= 1);
});

test("advice gate reframes sign-questions as document questions", () => {
  const gate = classifyAdviceQuestion("Should I sign this agreement?");
  assert.equal(gate.adviceMode, true);
  assert.match(gate.reframedQuestion, /document|clause|agreement/i);
});

test("fabricated citations and quotes are stripped and grounding ratio is computed", () => {
  const answer =
    "[C1] The client may terminate on 30 days' notice. \"The supplier shall indemnify the client without cap for all losses arising from services forever.\" [C99]";
  const verified = verifyGroundedAnswer(answer, clauses);

  assert.equal(verified.answer.includes("[C99]"), false);
  assert.equal(verified.answer.includes("[C1]"), true);
  assert.equal(verified.answer.includes("forever"), false);
  assert.ok(verified.groundingRatio >= 0.5);
});

test("answerQuestion asks the provider with the top 6 relevant clauses", async () => {
  let prompt = "";
  const provider = {
    async completeJson<T>(_system: string, user: string, schema: { parse: (value: unknown) => T }): Promise<T> {
      prompt = user;
      return schema.parse({ answer: "The client may terminate for convenience on 30 days' notice. [C1]" });
    },
  } as any;

  const result = await answerQuestion("What happens if I terminate early?", clauses, provider);
  assert.ok(prompt.includes("[C1]"));
  assert.ok(prompt.includes("Clause 1"));
  assert.ok(result.answer.includes("[C1]"));
  assert.ok(result.groundingRatio >= 0.5);
});

test("answerQuestion passes the requested language through to the model prompt", async () => {
  let systemPrompt = "";
  const provider = {
    async completeJson<T>(system: string, _user: string, schema: { parse: (value: unknown) => T }): Promise<T> {
      systemPrompt = system;
      return schema.parse({ answer: "The client may terminate for convenience on 30 days' notice. [C1]" });
    },
  } as any;

  await answerQuestion("What happens if I terminate early?", clauses, provider, "hi");
  assert.match(systemPrompt, /Answer in hi\./i);
});
