export type ParsedPage = {
  pageNumber: number;
  text: string;
};

export type ParsedDocument = {
  pageCount: number;
  pages: ParsedPage[];
  headings: string[];
  isScanned: boolean;
};

export type IngestionOptions = {
  maxBytes?: number;
  maxPages?: number;
  minimumTextPerPage?: number;
};

export type IngestionErrorCode = "FILE_TOO_LARGE" | "TOO_MANY_PAGES" | "SCANNED_DOCUMENT" | "UNSUPPORTED_FORMAT";

export class IngestionError extends Error {
  constructor(
    public readonly code: IngestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 60;
const DEFAULT_MINIMUM_TEXT_PER_PAGE = 20;

function detectHeadings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => /^[A-Z][A-Z\s&-]{3,}$/.test(line) || /^(?:ARTICLE\s+\d+(?:\.\d+)*|\d+(?:\.\d+)*[.)]?\s+)/.test(line));
}

export function parsePlainText(text: string, options: IngestionOptions = {}): ParsedDocument {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const minimumTextPerPage = options.minimumTextPerPage ?? DEFAULT_MINIMUM_TEXT_PER_PAGE;
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const byteLength = new TextEncoder().encode(normalized).byteLength;

  if (byteLength > maxBytes) {
    throw new IngestionError("FILE_TOO_LARGE", `Document exceeds the ${maxBytes}-byte limit.`);
  }

  const pages = normalized.split("\f").map((page, index) => ({
    pageNumber: index + 1,
    text: page,
  }));

  if (pages.length > maxPages) {
    throw new IngestionError("TOO_MANY_PAGES", `Document exceeds the ${maxPages}-page limit.`);
  }

  const headings = pages.flatMap((page) => detectHeadings(page.text));
  const isScanned = pages.some((page) => page.text.trim().length < minimumTextPerPage);

  if (isScanned) {
    throw new IngestionError("SCANNED_DOCUMENT", "This document has insufficient extractable text and may be scanned.");
  }

  return {
    pageCount: pages.length,
    pages,
    headings,
    isScanned,
  };
}