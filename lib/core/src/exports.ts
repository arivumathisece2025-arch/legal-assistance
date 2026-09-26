import { evaluateDocumentRisk, type RiskFinding } from "./rules/packV1";
import type { Obligation } from "./obligations";

export type PartyBreakdown = Record<"partyA" | "partyB", Obligation[]>;

export function buildObligationChecklist(obligations: Obligation[]): PartyBreakdown {
  const grouped: PartyBreakdown = { partyA: [], partyB: [] };

  for (const obligation of obligations) {
    const party = obligation.party === "partyB" ? "partyB" : "partyA";
    grouped[party].push(obligation);
  }

  for (const party of ["partyA", "partyB"] as const) {
    grouped[party].sort((left, right) => {
      const leftDate = left.dueDate ?? "9999-12-31";
      const rightDate = right.dueDate ?? "9999-12-31";
      return leftDate.localeCompare(rightDate) || left.what.localeCompare(right.what);
    });
  }

  return grouped;
}

export function buildIcsCalendar(obligations: Obligation[], title = "Clause Compass obligations"): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Clause Compass//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const [index, obligation] of obligations.entries()) {
    const safeDate = obligation.dueDate ?? new Date().toISOString().slice(0, 10);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${title.replace(/\s+/g, "-").toLowerCase()}-${index}-${obligation.sourceClauseId}`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
    lines.push(`DTSTART;VALUE=DATE:${safeDate.replace(/-/g, "")}`);
    lines.push(`SUMMARY:${(obligation.what || "Action item").slice(0, 75).replace(/[,;\\\n]/g, " ")}`);
    lines.push(`DESCRIPTION:${`Party: ${obligation.party}\\nWho: ${obligation.who}\\nDue: ${obligation.due}\\nClause: ${obligation.sourceClauseId}`.slice(0, 500).replace(/[,;\\\n]/g, " ")}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\n");
}

export type LawyerPrepBriefInput = {
  documentName: string;
  parties: readonly [string, string];
  findings: RiskFinding[] | { findings: RiskFinding[] };
  obligations?: Obligation[];
  unresolvedInconsistencies?: readonly string[];
};

export function buildLawyerPrepBrief({
  documentName,
  parties,
  findings,
  obligations = [],
  unresolvedInconsistencies = [],
}: LawyerPrepBriefInput): string {
  const normalizedFindings = Array.isArray(findings) ? findings : findings.findings;
  const topFindings = normalizedFindings.slice(0, 5);
  const dedupedQuestions = Array.from(
    new Set(
      topFindings
        .map((finding) => finding.askYourLawyer)
        .filter((question): question is string => Boolean(question)),
    ),
  );

  const checklist = buildObligationChecklist(obligations);
  const sections: string[] = [
    `# Lawyer Prep Brief`,
    ``,
    `## Document`,
    `- Name: ${documentName}`,
    `- Parties: ${parties.join(" / ")}`,
    ``,
    `## Top 5 risk findings`,
    "",
  ];

  if (topFindings.length === 0) {
    sections.push("No material risk findings were generated from the current document view.");
  } else {
    for (const [index, finding] of topFindings.entries()) {
      sections.push(`### ${index + 1}. ${finding.title} (${finding.clauseId})`);
      sections.push(`- Severity: ${finding.severity}`);
      sections.push(`- Explanation: ${finding.explanation}`);
      sections.push(`- Lawyer question: ${finding.askYourLawyer}`);
      sections.push(`- Clause text: ${finding.clauseText.slice(0, 220)}`);
      sections.push("");
    }
  }

  sections.push("## Checklist by party and deadline", "");
  for (const party of ["partyA", "partyB"] as const) {
    const items = checklist[party];
    sections.push(`### ${party === "partyA" ? parties[0] : parties[1]}`);
    if (items.length === 0) {
      sections.push("- No date-based obligations were extracted for this side.");
    } else {
      for (const item of items) {
        sections.push(`- ${item.what} — due ${item.dueDate ?? item.due} (${item.sourceClauseId})`);
      }
    }
    sections.push("");
  }

  sections.push("## Questions to ask counsel", "");
  if (dedupedQuestions.length === 0) {
    sections.push("- No specific counsel questions were generated from the current risk profile.");
  } else {
    for (const question of dedupedQuestions) {
      sections.push(`- ${question}`);
    }
  }

  if (unresolvedInconsistencies.length > 0) {
    sections.push("", "## Unresolved inconsistencies", "");
    for (const item of unresolvedInconsistencies) {
      sections.push(`- ${item}`);
    }
  }

  return sections.join("\n");
}

export function buildLawyerPrepBriefFromDocument(
  documentName: string,
  clauses: Array<{ id: string; heading: string; text: string; type?: string }>,
  obligations: Obligation[] = [],
): string {
  const findings = evaluateDocumentRisk(
    clauses.map((clause) => ({
      ...clause,
      ordinal: clause.id,
      page: 1,
      charStart: 0,
      charEnd: clause.text.length,
      type: clause.type ?? "other",
    } as any)),
    "both",
  );

  return buildLawyerPrepBrief({
    documentName,
    parties: ["Party A", "Party B"],
    findings,
    obligations,
    unresolvedInconsistencies: [
      "Confirm whether the governing law and forum selection are intentionally aligned.",
      "Verify any clause cross-reference or undefined shorthand against the final signed version.",
    ],
  });
}
