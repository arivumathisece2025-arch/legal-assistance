import assert from "node:assert/strict";
import test from "node:test";
import { IngestionError } from "../ingestion";
import { detectUploadFileType, validateUpload } from "../upload";

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
});