import { alignClauses } from "../align";
import { analyzeMaterialChange } from "./materialChange";
import { collectComparisonFindings, diffRiskFindings, isMaterialPairChange } from "./findings";
import { buildComparisonRows, summarizeComparison } from "./rows";
import type {
  CompareVersionsOptions,
  VersionComparison,
  VersionDocument,
} from "./types";

export * from "./types";
export * from "./materialChange";
export * from "./findings";
export * from "./rows";

/**
 * Full version comparison: pure alignment + deterministic findings diff, then
 * (optionally) one smart-model call per changed pair, cached by the pair hash.
 */
export async function compareVersions(
  base: VersionDocument,
  revised: VersionDocument,
  options: CompareVersionsOptions = {},
): Promise<VersionComparison> {
  const perspective = options.perspective ?? "both";
  const alignment = alignClauses(base.clauses, revised.clauses, {
    threshold: options.threshold,
    minMatchScore: options.minMatchScore,
  });

  const findings = collectComparisonFindings(base, revised);
  const materialChanges = new Map<string, import("./types").MaterialChangeNote>();

  if (options.analyzeMaterialChanges !== false && options.provider) {
    for (const pair of alignment.pairs) {
      const findingChanges = diffRiskFindings(
        findings.before.get(pair.before.id) ?? [],
        findings.after.get(pair.after.id) ?? [],
        perspective,
      );
      if (!isMaterialPairChange(pair, findingChanges)) continue;
      materialChanges.set(pair.key, await analyzeMaterialChange(pair, options.provider, options.model));
    }
  }

  const rows = buildComparisonRows({ alignment, base, revised, perspective, materialChanges, findings });

  return {
    base: { id: base.id, name: base.name },
    revised: { id: revised.id, name: revised.name },
    threshold: alignment.threshold,
    perspective,
    rows,
    summary: summarizeComparison(rows),
  };
}