import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { IngestionError, type ParsedDocument } from "../ingestion";

type TextItem = { str?: string };

export async function parsePdf(bytes: Uint8Array, minimumTextPerPage = 20): Promise<ParsedDocument> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useWorkerFetch: false,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => (item as TextItem).str ?? "").join(" ").trim();
    pages.push({ pageNumber, text });
  }

  if (pages.length > 60) {
    throw new IngestionError("TOO_MANY_PAGES", "Document exceeds the 60-page limit.");
  }

  if (pages.some((page) => page.text.length < minimumTextPerPage)) {
    throw new IngestionError("SCANNED_DOCUMENT", "This PDF has insufficient extractable text and may be scanned.");
  }

  const headings = pages.flatMap((page) =>
    page.text
      .split(/(?=[A-Z][A-Z\s&-]{3,}\b)/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z][A-Z\s&-]{3,}$/.test(line)),
  );

  return { pageCount: pages.length, pages, headings, isScanned: false };
}