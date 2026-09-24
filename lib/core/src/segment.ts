import type { ParsedDocument } from "./ingestion";

export type Clause = {
  id: string;
  ordinal: string;
  heading: string;
  text: string;
  page: number;
  charStart: number;
  charEnd: number;
};

type Marker = {
  start: number;
  lineEnd: number;
  ordinal: string;
  heading: string;
};

const NUMBERED = /^(\d+(?:\.\d+)*[.)]?)[ \t]+(.+)$/;
const LETTERED = /^(\([a-z]\))[ \t]+(.+)$/i;
const ARTICLE = /^(ARTICLE\s+[IVXLCDM\d]+)(?:[.:)\s]+(.*))?$/i;
const WHEREAS = /^(WHEREAS)(?:[,:\s]+(.*))?$/i;
const ALL_CAPS = /^[A-Z][A-Z\s&-]{3,}$/;

function markerForLine(line: string, start: number, lineEnd: number): Marker | null {
  const trimmed = line.trim();
  const markerStart = start + Math.max(0, line.search(/\S/));
  const numbered = NUMBERED.exec(trimmed);
  if (numbered) return { start: markerStart, lineEnd, ordinal: numbered[1], heading: numbered[2].trim() };

  const lettered = LETTERED.exec(trimmed);
  if (lettered) return { start: markerStart, lineEnd, ordinal: lettered[1], heading: lettered[2].trim() };

  const article = ARTICLE.exec(trimmed);
  if (article) return { start: markerStart, lineEnd, ordinal: article[1], heading: article[2]?.trim() || article[1] };

  const whereas = WHEREAS.exec(trimmed);
  if (whereas) return { start: markerStart, lineEnd, ordinal: whereas[1], heading: whereas[2]?.trim() || whereas[1] };

  if (ALL_CAPS.test(trimmed)) return { start: markerStart, lineEnd, ordinal: trimmed, heading: trimmed };
  return null;
}

function trimRange(source: string, start: number, end: number): { start: number; end: number } {
  while (start < end && /\s/.test(source[start] ?? "")) start += 1;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return { start, end };
}

export function segmentDocument(document: ParsedDocument): Clause[] {
  const source = document.pages.map((page) => page.text).join("\f");
  const pageStarts: Array<{ page: number; start: number; end: number }> = [];
  let pageOffset = 0;
  for (const page of document.pages) {
    pageStarts.push({ page: page.pageNumber, start: pageOffset, end: pageOffset + page.text.length });
    pageOffset += page.text.length + 1;
  }

  const markers: Marker[] = [];
  let lineStart = 0;
  for (const line of source.split(/[\n\f]/)) {
    const lineEnd = lineStart + line.length;
    const marker = markerForLine(line, lineStart, lineEnd);
    if (marker) markers.push(marker);
    lineStart = lineEnd + 1;
  }

  return markers.map((marker, index) => {
    const nextStart = markers[index + 1]?.start ?? source.length;
    const range = trimRange(source, marker.start, nextStart);
    const page = pageStarts.find((item) => marker.start >= item.start && marker.start <= item.end)?.page ?? 1;
    return {
      id: `C${index + 1}`,
      ordinal: marker.ordinal,
      heading: marker.heading,
      text: source.slice(range.start, range.end),
      page,
      charStart: range.start,
      charEnd: range.end,
    };
  });
}