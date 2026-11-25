import { resolveClauseType } from "../align";
import type { RiskPerspective } from "../rules/packV1";
import type {
  BuildComparisonRowsInput,
  ChangeLabel,
  ClauseView,
  ComparisonRow,
  FindingChange,
  MaterialChangeNote,
  VersionComparisonSummary,
  VersionDocument,
} from "./types";
import { collectComparisonFindings, diffRiskFindings, isMaterialPairChange } from "./findings";

function toClauseView(clause: VersionDocument["clauses"][number]): ClauseView {
  return {
    id: clause.id,
    ordinal: clause.ordinal ?? clause.id,
    heading: clause.heading,
    type: resolveClauseType(clause),
    text: clause.text,
  };
}

function dedupeLabels(labels: ChangeLabel[]): ChangeLabel[] {
  return Array.from(new Set(labels));
}

/** "Favors other party" comes from the model's verdict against the reader's side. */
function materialChangeLabels(note: MaterialChangeNote | undefined, perspective: RiskPerspective): ChangeLabel[] {
  if (!note || !note.available || note.favors === "neither" || perspective === "both") return [];
  return note.favors === perspective ? [] : ["Favors other party"];
}

function findingLabels(findingChanges: FindingChange[]): ChangeLabel[] {
  return findingChanges.some((change) => change.favorsOtherParty) ? ["Favors other party"] : [];
}

/**
 * Turns an alignment plus the packV1 findings of both versions into the rows the
 * comparison view renders, in document order, with a plain text label per change.
 */
export function buildComparisonRows({
  alignment,
  base,
  revised,
  perspective = "both",
  materialChanges = new Map(),
  findings,
}: BuildComparisonRowsInput): ComparisonRow[] {
  const { before: beforeFindings, after: afterFindings } = findings ?? collectComparisonFindings(base, revised);
  const revisedIndexById = new Map(revised.clauses.map((clause, index) => [clause.id, index]));
  const drafts: Array<{ position: number; sequence: number; row: ComparisonRow }> = [];
  let sequence = 0;

  for (const pair of alignment.pairs) {
    const findingChanges = diffRiskFindings(
      beforeFindings.get(pair.before.id) ?? [],
      afterFindings.get(pair.after.id) ?? [],
      perspective,
    );
    const note = materialChanges.get(pair.key);
    const labels: ChangeLabel[] = [];
    const changed = isMaterialPairChange(pair, findingChanges);
    if (changed) {
      labels.push("Changed");
      labels.push(...materialChangeLabels(note, perspective));
    }
    labels.push(...findingLabels(findingChanges));

    drafts.push({
      position: pair.afterIndex,
      sequence: sequence++,
      row: {
        key: pair.key,
        kind: changed ? "changed" : "unchanged",
        similarity: pair.similarity,
        labels: dedupeLabels(labels),
        before: toClauseView(pair.before),
        after: toClauseView(pair.after),
        breakdown: pair.breakdown,
        materialChange: note,
        findingChanges,
      },
    });
  }

  for (const clause of alignment.added) {
    const findingChanges = diffRiskFindings([], afterFindings.get(clause.id) ?? [], perspective);
    drafts.push({
      position: revisedIndexById.get(clause.id) ?? revised.clauses.length,
      sequence: sequence++,
      row: {
        key: `added~${clause.id}`,
        kind: "added",
        similarity: 0,
        labels: dedupeLabels(["Added", ...findingLabels(findingChanges)]),
        after: toClauseView(clause),
        findingChanges,
      },
    });
  }

  for (const clause of alignment.removed) {
    const beforeIndex = base.clauses.findIndex((candidate) => candidate.id === clause.id);
    const nextPair = alignment.pairs
      .filter((pair) => pair.beforeIndex > beforeIndex)
      .sort((left, right) => left.afterIndex - right.afterIndex)[0];
    const findingChanges = diffRiskFindings(beforeFindings.get(clause.id) ?? [], [], perspective);

    drafts.push({
      position: nextPair ? nextPair.afterIndex - 0.5 : revised.clauses.length + 0.5,
      sequence: sequence++,
      row: {
        key: `removed~${clause.id}`,
        kind: "removed",
        similarity: 0,
        labels: dedupeLabels(["Removed", ...findingLabels(findingChanges)]),
        before: toClauseView(clause),
        findingChanges,
      },
    });
  }

  return drafts
    .sort((left, right) => left.position - right.position || left.sequence - right.sequence)
    .map((draft) => draft.row);
}

export function summarizeComparison(rows: ComparisonRow[]): VersionComparisonSummary {
  return {
    totalRows: rows.length,
    changedCount: rows.filter((row) => row.kind === "changed").length,
    addedCount: rows.filter((row) => row.kind === "added").length,
    removedCount: rows.filter((row) => row.kind === "removed").length,
    unchangedCount: rows.filter((row) => row.kind === "unchanged").length,
    introducedRiskCount: rows.reduce(
      (total, row) => total + row.findingChanges.filter((change) => change.status === "introduced").length,
      0,
    ),
    resolvedRiskCount: rows.reduce(
      (total, row) => total + row.findingChanges.filter((change) => change.status === "resolved").length,
      0,
    ),
    favorsOtherPartyCount: rows.filter((row) => row.labels.includes("Favors other party")).length,
  };
}
