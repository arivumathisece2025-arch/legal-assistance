import mammoth from "mammoth";
import { parsePlainText, type ParsedDocument } from "../ingestion";

export async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return parsePlainText(result.value);
}