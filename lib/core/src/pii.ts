export type PiiKind =
  | "AADHAAR"
  | "PAN"
  | "MOBILE"
  | "EMAIL"
  | "BANK_ACCOUNT"
  | "GSTIN"
  | "IFSC";

export type PiiMatch = {
  value: string;
  kind: PiiKind;
  start: number;
  end: number;
};

export type PiiRedactionMap = Record<string, string>;

const VERHOEFF_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 4, 0, 2, 1, 3],
  [7, 6, 5, 9, 8, 3, 2, 0, 4, 1],
  [8, 7, 6, 5, 9, 2, 1, 4, 0, 3],
  [9, 8, 7, 6, 5, 1, 3, 2, 4, 0],
] as const;

const VERHOEFF_PERMUTATION = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

function verhoeffChecksum(value: string): boolean {
  const digits = Array.from(value.replace(/\D/g, ""), (char) => Number.parseInt(char, 10));
  if (digits.length !== 12) return false;

  let checksum = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = digits[index];
    checksum = VERHOEFF_TABLE[checksum][VERHOEFF_PERMUTATION[digit]];
  }

  return checksum === 0;
}

function isAadhaar(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 && verhoeffChecksum(digits);
}

function isPan(value: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(value);
}

function isMobile(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^((\+91|91)?[6-9]\d{9})$/.test(value) || /^[6-9]\d{9}$/.test(digits);
}

function isBankAccount(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^(\d{9}|\d{12}|\d{15}|\d{18})$/.test(digits);
}

function isGstin(value: string): boolean {
  return /^\d{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(value.toUpperCase());
}

function isIfsc(value: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value.toUpperCase());
}

const PII_PATTERNS: Array<[RegExp, PiiKind]> = [
  [/\d{12}/g, "AADHAAR"],
  [/[A-Z]{5}[0-9]{4}[A-Z]/g, "PAN"],
  [/(?:\+?91[-\s]?)?[6-9]\d{9}/g, "MOBILE"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "EMAIL"],
  [/\d{9,18}/g, "BANK_ACCOUNT"],
  [/\d{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]/g, "GSTIN"],
  [/[A-Z]{4}0[A-Z0-9]{6}/g, "IFSC"],
];

function matchesByKind(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [];

  for (const [pattern, kind] of PII_PATTERNS) {
    const regex = new RegExp(pattern, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      if (kind === "AADHAAR" && !isAadhaar(value)) continue;
      if (kind === "PAN" && !isPan(value)) continue;
      if (kind === "MOBILE" && !isMobile(value)) continue;
      if (kind === "BANK_ACCOUNT" && !isBankAccount(value)) continue;
      if (kind === "GSTIN" && !isGstin(value)) continue;
      if (kind === "IFSC" && !isIfsc(value)) continue;

      matches.push({ value, kind, start, end });
    }
  }

  matches.sort((a, b) => a.start - b.start || a.end - b.end);

  const filtered: PiiMatch[] = [];
  for (const match of matches) {
    const previous = filtered[filtered.length - 1];
    if (previous && match.start < previous.end) {
      continue;
    }
    filtered.push(match);
  }

  return filtered;
}

export function redactPii(text: string): { redacted: string; rehydrationMap: PiiRedactionMap } {
  const matches = matchesByKind(text);
  const rehydrationMap: PiiRedactionMap = {};
  let cursor = 0;
  const parts: string[] = [];

  for (const match of matches) {
    parts.push(text.slice(cursor, match.start));
    const token = `[[PII:${match.kind}:${Object.keys(rehydrationMap).length + 1}]]`;
    rehydrationMap[token] = match.value;
    parts.push(token);
    cursor = match.end;
  }

  parts.push(text.slice(cursor));

  return {
    redacted: parts.join(""),
    rehydrationMap,
  };
}

export function rehydratePii(text: string, rehydrationMap: PiiRedactionMap): string {
  let rebuilt = text;
  for (const [token, value] of Object.entries(rehydrationMap)) {
    rebuilt = rebuilt.replaceAll(token, value);
  }
  return rebuilt;
}
