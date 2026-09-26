import assert from "node:assert/strict";
import test from "node:test";
import { postCheckSimplification, simplifyClauses } from "../simplify";

const clauses = [
  {
    id: "C1",
    ordinal: "1",
    heading: "Payment",
    text: "The supplier shall pay the fee within 12 months of the start date.",
    page: 1,
    charStart: 0,
    charEnd: 90,
  },
];

test("postCheckSimplification flags invented numbers or dates", () => {
  const flagged = postCheckSimplification(
    "The supplier shall pay the fee within 12 months of the start date.",
    "The supplier shall pay the fee within 18 months of 2027-01-01.",
  );

  assert.equal(flagged.flagged, true);
  assert.ok(flagged.issues.length > 0);
});

test("simplifyClauses returns three levels and flags invented figure in a rewrite", async () => {
  let callCount = 0;
  const provider = {
    async completeJson<T>(_system: string, _user: string, schema: { parse: (value: unknown) => T }): Promise<T> {
      callCount += 1;
      return schema.parse({
        items: [
          { clauseId: "C1", level: "as-written", text: "The supplier shall pay the fee within 12 months of the start date." },
          { clauseId: "C1", level: "plain", text: "The supplier pays the fee within 18 months from the start date." },
          { clauseId: "C1", level: "simple", text: "You pay the fee in 18 months." },
        ],
      }) as T;
    },
  } as any;

  const result = await simplifyClauses(clauses, provider, "en");
  assert.equal(callCount, 1);
  assert.equal(result.length, 3);
  assert.equal(result.some((item) => item.flagged), true);
  assert.equal(result.filter((item) => item.level === "plain").length, 1);
});

test("simplifyClauses normalizes requested languages into the prompt payload", async () => {
  let userPrompt = "";
  const provider = {
    async completeJson<T>(_system: string, user: string, schema: { parse: (value: unknown) => T }): Promise<T> {
      userPrompt = user;
      return schema.parse({
        items: [
          { clauseId: "C1", level: "plain", text: "The supplier must pay the fee within 12 months." },
        ],
      }) as T;
    },
  } as any;

  await simplifyClauses(clauses, provider, "hindi");
  assert.match(userPrompt, /Language: hi/);
});
