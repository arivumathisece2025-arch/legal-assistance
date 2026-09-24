export type InjectionFinding = {
  pattern: string;
  page: number;
  offset: number;
  severity: "info" | "warning";
};

const INJECTION_PATTERNS = [
  "ignore previous instructions",
  "you are now",
  "system:",
  "disregard the above",
];

export function scanInjection(
  text: string,
  page = 1,
  metadata: Array<Record<string, unknown>> = [],
): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  const lowered = text.toLowerCase();

  for (const pattern of INJECTION_PATTERNS) {
    const index = lowered.indexOf(pattern);
    if (index >= 0) {
      findings.push({
        pattern,
        page,
        offset: index,
        severity: "info",
      });
    }
  }

  if (/(?:[A-Za-z0-9+/]{200,}={0,2})/.test(text)) {
    findings.push({ pattern: "base64_blob", page, offset: 0, severity: "warning" });
  }

  if (/\u200b|\u200c|\ufeff|\u2060/.test(text)) {
    findings.push({ pattern: "zero_width", page, offset: 0, severity: "warning" });
  }

  for (const item of metadata) {
    const color = typeof item.color === "string" ? item.color.toLowerCase() : "";
    if (color === "#ffffff" || color === "white" || color === "ffffff") {
      findings.push({
        pattern: "white_on_white",
        page,
        offset: Number(item.offset ?? 0),
        severity: "warning",
      });
    }
  }

  return findings;
}
