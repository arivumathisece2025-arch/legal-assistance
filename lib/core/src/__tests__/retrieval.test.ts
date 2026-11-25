import assert from "node:assert/strict";
import test from "node:test";
import { buildRetrievalIndex, retrieveClauses, retrieveFromIndex } from "../retrieval";
import type { Clause } from "../segment";

function clause(id: string, heading: string, text: string): Clause {
  return { id, ordinal: id, heading, text, page: 1, charStart: 0, charEnd: text.length };
}

test("BM25 gives a rare term more weight than a common term", () => {
  const clauses = [
    clause("C1", "Common term", "common rare"),
    clause("C2", "Common term", "common common"),
    clause("C3", "Common term", "common common"),
  ];

  const results = retrieveClauses(clauses, "common rare");
  assert.equal(results[0]?.id, "C1");
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});

test("retrieval matches whole tokens rather than substrings", () => {
  const results = retrieveClauses([clause("C1", "Advance", "Advance notice is required.")], "ad");
  assert.deepEqual(results[0]?.matches, []);
  assert.equal(results[0]?.score, 0);
});

test("light stemming matches amend with amendment", () => {
  const results = retrieveClauses([clause("C1", "Amendment", "The parties may amend this agreement.")], "amendment");
  assert.ok((results[0]?.score ?? 0) > 0);
  assert.ok(results[0]?.matches.includes("amend"));
});

test("a document index is reused across repeated queries without rebuilding term frequencies", () => {
  const clauses = [clause("C1", "Termination", "Either party may end the agreement.")];
  const index = buildRetrievalIndex(clauses);
  const frequencies = index.entries[0]?.frequencies;

  for (let iteration = 0; iteration < 20; iteration += 1) {
    retrieveFromIndex(index, `termination question ${iteration}`);
  }

  assert.strictEqual(index.entries[0]?.frequencies, frequencies);
  assert.equal(index.documentFrequency.get("terminat"), undefined);
  assert.ok(index.documentFrequency.has("termination"));
});