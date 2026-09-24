import { IngestionError } from "./ingestion";

export type UploadFileType = "pdf" | "docx" | "text";

export type ValidatedUpload = {
  fileType: UploadFileType;
  bytes: Uint8Array;
};

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const PDF_SIGNATURE = "%PDF-";
const DOCX_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const PDF_ACTIVE_CONTENT = /\/(?:JavaScript|EmbeddedFile|Launch|OpenAction)\b/i;

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

  if (fileType === "pdf" && PDF_ACTIVE_CONTENT.test(new TextDecoder().decode(bytes))) {
    throw new IngestionError("UNSUPPORTED_FORMAT", "PDF contains active content that cannot be accepted.");
  }

  return { fileType, bytes };
}