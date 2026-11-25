import { resolveClauseType, type AlignableClause, type AlignedClausePair } from "../align";
import {
  evaluateDocumentRisk,
  PACK_V1_RULES,
  type RiskClause,
  type RiskFinding,
  type RiskPerspective,
  type RiskSeverity,
} from "../rules/packV1";
import type { ComparisonFindings, FindingChange, FindingChangeStatus, VersionDocument } from "./types";

function toRiskClauses(clauses: AlignableClause[]): RiskClause[] {
  return clauses.map((clause) => ({
    id: clause.id,
    ordinal: clause.ordinal ?? clause.id,
    heading: clause.heading,
    text: clause.text,
    page: 1,
    charStart: 0,
    charEnd: clause.text.length,
    type: resolveClauseType(clause),
  }));
}

function findingMessage(status: FindingChangeStatus, finding: RiskFinding): string {
  switch (status) {
    case "introduced":
      return `This version introduced a ${finding.severity}-risk finding: ${finding.title} (clause ${finding.clauseId}).`;
    case "resolved":
      return `This version removed the ${finding.severity}-risk finding: ${finding.title} (was clause ${finding.clauseId}).`;
    case "changed":
      return `The ${finding.severity}-risk finding ${finding.title} still applies, but the wording of this clause changed.`;
    case "unchanged":
    default:
      return `The ${finding.severity}-risk finding ${finding.title} still applies unchanged.`;
  }
}

function favorsOtherParty(status: FindingChangeStatus, concerns: RiskPerspective, perspective: RiskPerspective): boolean {
  if (status !== "introduced" || perspective === "both" || concerns === "both") return false;
  return concerns === perspective;
}

/**
 * Diffs the packV1 findings of two clause scopes. Compare a matched pair's own
 * findings, an added clause against nothing, or a removed clause against nothing.
 */
export function diffRiskFindings(
  beforeFindings: RiskFinding[],
  afterFindings: RiskFinding[],
  perspective: RiskPerspective = "both",
): FindingChange[] {
  const beforeByRule = new Map(beforeFindings.map((finding) => [finding.ruleId, finding]));
  const afterByRule = new Map(afterFindings.map((finding) => [finding.ruleId, finding]));
  const ruleIds = Array.from(new Set([...beforeByRule.keys(), ...afterByRule.keys()]));

  const severityOrder: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };

  const changes: FindingChange[] = [];

  for (const ruleId of ruleIds) {
    const before = beforeByRule.get(ruleId);
    const after = afterByRule.get(ruleId);
    const reference = after ?? before;
    if (!reference) continue;

    const status: FindingChangeStatus = !before
      ? "introduced"
      : !after
        ? "resolved"
        : before.clauseText === after.clauseText
          ? "unchanged"
          : "changed";
    const label: FindingChange["label"] =
      status === "introduced" ? "Added" : status === "resolved" ? "Removed" : status === "changed" ? "Changed" : undefined;
    // `finding.perspective` is the perspective the caller asked for, so the
    // rule's own perspective has to come from the rule pack.
    const concerns = PACK_V1_RULES.find((rule) => rule.id === ruleId)?.perspective ?? reference.perspective;

    changes.push({
      status,
      ...(label ? { label } : {}),
      ruleId,
      title: reference.title,
      severity: reference.severity,
      concerns,
      favorsOtherParty: favorsOtherParty(status, concerns, perspective),
      message: findingMessage(status, reference),
      beforeClauseId: before?.clauseId,
      afterClauseId: after?.clauseId,
    });
  }

  return changes.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.status.localeCompare(right.status),
  );
}

function groupFindingsByClause(findings: RiskFinding[]): Map<string, RiskFinding[]> {
  const grouped = new Map<string, RiskFinding[]>();
  for (const finding of findings) {
    grouped.set(finding.clauseId, [...(grouped.get(finding.clauseId) ?? []), finding]);
  }
  return grouped;
}

/** Runs the deterministic rule pack once per version and groups findings by clause. */
export function collectComparisonFindings(base: VersionDocument, revised: VersionDocument): ComparisonFindings {
  return {
    before: groupFindingsByClause(evaluateDocumentRisk(toRiskClauses(base.clauses), "both").findings),
    after: groupFindingsByClause(evaluateDocumentRisk(toRiskClauses(revised.clauses), "both").findings),
  };
}

/**
 * A pair is a material change when the text moved (similarity or a figure) OR
 * when the rule engine reports a finding that appeared, disappeared or changed
 * for that clause. The second half is what surfaces "this version introduced an
 * uncapped indemnity" even when a long clause barely moves its token overlap.
 */
export function isMaterialPairChange(pair: AlignedClausePair, findingChanges: FindingChange[]): boolean {
  return pair.changed || findingChanges.some((change) => change.status !== "unchanged");
}