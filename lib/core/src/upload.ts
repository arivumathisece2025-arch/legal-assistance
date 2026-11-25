import { IngestionError } from "./ingestion";

export type UploadFileType = "pdf" | "docx" | "text";

export type ValidatedUpload = {
  fileType: UploadFileType;
  bytes: Uint8Array;
};

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const PDF_SIGNATURE = "%PDF-";
const DOCX_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
// Best-effort active-content filter only; this is not a PDF sandbox.
const PDF_ACTIVE_CONTENT = /\/(?:JavaScript|JS|EmbeddedFile|Launch|OpenAction|AA|RichMedia|XFA)\b/i;

export function scanPdfForActiveContent(bytes: Uint8Array, onChunkScanned?: () => void): boolean {
  const decoder = new TextDecoder("latin1");
  const chunkSize = 32 * 1024;
  const overlap = 64;
  let foundObjectStream = false;
  let foundScript = false;

  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    onChunkScanned?.();
    const start = Math.max(0, offset - overlap);
    const end = Math.min(bytes.byteLength, offset + chunkSize);
    const normalized = decoder.decode(bytes.subarray(start, end)).replace(
      /#([0-9a-fA-F]{2})/g,
      (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
    );

    if (PDF_ACTIVE_CONTENT.test(normalized)) return true;
    foundObjectStream ||= /\/ObjStm\b/i.test(normalized);
    foundScript ||= /\/(?:JS|JavaScript)\b/i.test(normalized);
    if (foundObjectStream && foundScript) return true;
  }

  return false;
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function startsWithText(bytes: Uint8Array, signature: string): boolean {
  return new TextDecoder().decode(bytes.slice(0, signature.length)) === signature;
}

export function detectUploadFileType(bytes: Uint8Array): UploadFileType | null {
  if (startsWithText(bytes, PDF_SIGNATURE)) return "pdf";
  if (startsWithBytes(bytes, DOCX_SIGNATURE)) return "docx";

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text";
  } catch {
    return null;
  }
}

export function validateUpload(bytes: Uint8Array): ValidatedUpload {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new IngestionError("FILE_TOO_LARGE", "Upload exceeds the 15 MB limit.");
  }

  const fileType = detectUploadFileType(bytes);
  if (!fileType) {
    throw new IngestionError("UNSUPPORTED_FORMAT", "Upload is not a supported PDF, DOCX, or UTF-8 text file.");
  }

  if (fileType === "pdf") {
    if (scanPdfForActiveContent(bytes)) {
      throw new IngestionError("UNSUPPORTED_FORMAT", "PDF contains active content that cannot be accepted.");
    }
  }

  return { fileType, bytes };
}