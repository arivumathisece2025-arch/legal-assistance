import { parsePlainText, type ParsedDocument } from "../ingestion";
import { validateUpload, type UploadFileType } from "../upload";
import { parseDocx } from "./docx";
import { parsePdf } from "./pdf";

export { parseDocx } from "./docx";
export { parsePdf } from "./pdf";

export type ProcessedUpload = ParsedDocument & {
  fileType: UploadFileType;
  redactedPages: ParsedDocument["pages"];
  rehydrationMap: Record<string, string>;
  securityFindings: ReturnType<typeof import("../injection").scanInjection>;
};

export async function parseUpload(bytes: Uint8Array): Promise<{ fileType: UploadFileType; document: ParsedDocument }> {
  const validated = validateUpload(bytes);
  if (validated.fileType === "pdf") return { fileType: "pdf", document: await parsePdf(bytes) };
  if (validated.fileType === "docx") return { fileType: "docx", document: await parseDocx(bytes) };
  return { fileType: "text", document: parsePlainText(new TextDecoder().decode(bytes)) };
}

export async function processUpload(bytes: Uint8Array): Promise<ProcessedUpload> {
  const { fileType, document } = await parseUpload(bytes);
  const source = document.pages.map((page) => page.text).join("\f");
  const { redactPii } = await import("../pii");
  const { scanInjection } = await import("../injection");
  const redacted = redactPii(source);
  const redactedPages = redacted.redacted.split("\f").map((text, index) => ({ pageNumber: index + 1, text }));
  const securityFindings = document.pages.flatMap((page) => scanInjection(page.text, page.pageNumber));

  return {
    ...document,
    fileType,
    redactedPages,
    rehydrationMap: redacted.rehydrationMap,
    securityFindings,
  };
}