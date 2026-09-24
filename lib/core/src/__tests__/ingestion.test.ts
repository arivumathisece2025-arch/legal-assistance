import assert from "node:assert/strict";
import test from "node:test";
import { IngestionError, parsePlainText } from "../ingestion";

const pageText = "PAYMENT TERMS\nThe customer shall pay each invoice within thirty days of receipt.";

test("normalizes plain text pages and detects headings", () => {
  const document = parsePlainText(`${pageText}\fARTICLE 2\nThe provider shall deliver the services described in this agreement.`);

  assert.equal(document.pageCount, 2);
  assert.deepEqual(document.pages.map((page) => page.pageNumber), [1, 2]);
  assert.deepEqual(document.headings, ["PAYMENT TERMS", "ARTICLE 2"]);
  assert.equal(document.isScanned, false);
});

test("rejects oversized and over-page-limit documents with typed errors", () => {
  assert.throws(
    () => parsePlainText("x".repeat(11), { maxBytes: 10, minimumTextPerPage: 0 }),
    (error: unknown) => error instanceof IngestionError && error.code === "FILE_TOO_LARGE",
  );
  assert.throws(
    () => parsePlainText(`${pageText}\f${pageText}`, { maxPages: 1 }),
    (error: unknown) => error instanceof IngestionError && error.code === "TOO_MANY_PAGES",
  );
});

test("rejects pages without enough extractable text as scanned documents", () => {
  assert.throws(
    () => parsePlainText("\f${pageText}".replace("${pageText}", pageText)),
    (error: unknown) => error instanceof IngestionError && error.code === "SCANNED_DOCUMENT",
  );
});