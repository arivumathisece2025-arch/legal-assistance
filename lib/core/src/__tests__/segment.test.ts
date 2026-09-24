import assert from "node:assert/strict";
import test from "node:test";
import { segmentDocument } from "../segment";

const document = (text: string) => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text }],
  headings: [],
  isScanned: false,
});

test("segments numbered clauses with exact source offsets", () => {
  const source = "1. Payment\nCustomer shall pay within 30 days.\n1.1 Late fees\nLate fees apply.";
  const clauses = segmentDocument(document(source));

  assert.equal(clauses.length, 2);
  assert.equal(clauses[0]?.ordinal, "1.");
  assert.equal(clauses[1]?.ordinal, "1.1");
  assert.equal(source.slice(clauses[0]?.charStart, clauses[0]?.charEnd), clauses[0]?.text);
  assert.equal(source.slice(clauses[1]?.charStart, clauses[1]?.charEnd), clauses[1]?.text);
});

test("recognizes six common contract heading forms", () => {
  const source = [
    "1. Payment\nPay on time.",
    "1.1 Late fees\nFees apply.",
    "(a) Notice\nGive notice.",
    "ARTICLE IV\nGoverning law.",
    "WHEREAS, the parties agree\nBackground.",
    "CONFIDENTIALITY\nKeep information private.",
  ].join("\n");
  const clauses = segmentDocument(document(source));

  assert.deepEqual(clauses.map((clause) => clause.ordinal), ["1.", "1.1", "(a)", "ARTICLE IV", "WHEREAS", "CONFIDENTIALITY"]);
  assert.deepEqual(clauses.map((clause) => clause.id), ["C1", "C2", "C3", "C4", "C5", "C6"]);
});

test("assigns clauses to their source page", () => {
  const parsed = {
    pageCount: 2,
    pages: [
      { pageNumber: 1, text: "1. First clause\nText." },
      { pageNumber: 2, text: "2. Second clause\nMore text." },
    ],
    headings: [],
    isScanned: false,
  };

  assert.deepEqual(segmentDocument(parsed).map((clause) => clause.page), [1, 2]);
});