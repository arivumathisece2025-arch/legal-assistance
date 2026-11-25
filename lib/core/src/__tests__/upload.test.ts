import assert from "node:assert/strict";
import test from "node:test";
import { IngestionError } from "../ingestion";
import { detectUploadFileType, scanPdfForActiveContent, validateUpload } from "../upload";

const bytes = (value: string) => new TextEncoder().encode(value);

test("sniffs supported formats from bytes instead of trusting filenames", () => {
  assert.equal(detectUploadFileType(bytes("%PDF-1.7")), "pdf");
  assert.equal(detectUploadFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])), "docx");
  assert.equal(detectUploadFileType(bytes("plain contract text")), "text");
  assert.equal(detectUploadFileType(new Uint8Array([0xff, 0xfe, 0xfd])), null);
});

test("rejects oversized uploads and active PDF content", () => {
  assert.throws(
    () => validateUpload(new Uint8Array(15 * 1024 * 1024 + 1)),
    (error: unknown) => error instanceof IngestionError && error.code === "FILE_TOO_LARGE",
  );
  assert.throws(
    () => validateUpload(bytes("%PDF-1.7\n/OpenAction << /JavaScript true >>")),
    (error: unknown) => error instanceof IngestionError && error.code === "UNSUPPORTED_FORMAT",
  );
  assert.throws(
    () => validateUpload(bytes("%PDF-1.7\n/J#61vaScript true")),
    (error: unknown) => error instanceof IngestionError && error.code === "UNSUPPORTED_FORMAT",
  );
  assert.throws(
    () => validateUpload(bytes("%PDF-1.7\n/ObjStm /J#53")),
    (error: unknown) => error instanceof IngestionError && error.code === "UNSUPPORTED_FORMAT",
  );
  for (const activeName of ["/AA", "/RichMedia", "/XFA"]) {
    assert.throws(
      () => validateUpload(bytes(`%PDF-1.7\n${activeName}`)),
      (error: unknown) => error instanceof IngestionError && error.code === "UNSUPPORTED_FORMAT",
    );
  }
});

test("accepts a clean PDF and checks binary content without UTF-8 decoding", () => {
  const cleanPdf = new Uint8Array([...bytes("%PDF-1.7\n1 0 obj << /Type /Catalog >>\n"), 0xff, 0x00]);
  const validated = validateUpload(cleanPdf);

  assert.equal(validated.fileType, "pdf");
  assert.strictEqual(validated.bytes, cleanPdf);
});

test("the PDF active-content scan returns immediately on its first match", () => {
  const largePdf = new Uint8Array(2 * 1024 * 1024);
  largePdf.fill(0x20);
  largePdf.set(bytes("%PDF-1.7\n/JavaScript"), 0);
  let scannedChunks = 0;

  assert.equal(scanPdfForActiveContent(largePdf, () => { scannedChunks += 1; }), true);
  assert.equal(scannedChunks, 1);
});