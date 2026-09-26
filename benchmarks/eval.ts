import { parsePlainText } from "../lib/core/src/ingestion";
import { segmentDocument } from "../lib/core/src/segment";
import { resolveClauseType, jaccardSimilarity } from "../lib/core/src/align";
import { evaluateRiskRules, packV1Rules } from "../lib/core/src/rules/packV1";
import { retrieveClauses } from "../lib/core/src/retrieval";
import type { Clause } from "../lib/core/src/segment";
import type { ClauseType } from "../lib/core/src/classify";
import { goldenSet, renderContractText } from "./fixtures/goldenSet";

export type Metrics = { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number };

export function f1(tp: number, fp: number, fn: number): Metrics {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1Score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1: f1Score, tp, fp, fn };
}

/**
 * `segmentDocument` keeps the whole post-ordinal line as the heading, so the
 * golden heading is the text up to the first period. Compare on that basis.
 */
function headingKey(value: string): string {
  return value.split(".")[0]?.trim().toLowerCase() ?? value.trim().toLowerCase();
}

type DocRun = {
  clauses: Clause[];
  types: ClauseType[];
  rules: string[];
  citations: { expected: string; actual: string; ok: boolean; grounding: number }[];
};

function runDocument(contractId: string): DocRun {
  const contract = goldenSet.find((entry) => entry.id === contractId);
  if (!contract) throw new Error(`Unknown golden contract: ${contractId}`);

  const parsed = parsePlainText(renderContractText(contract));
  const clauses = segmentDocument(parsed);
  const types = clauses.map((clause) => resolveClauseType(clause));
  const findings = evaluateRiskRules(clauses);
  const rules = [...new Set(findings.map((finding) => finding.ruleId))];

  const citations = contract.qaPairs.map((pair) => {
    const retrieved = retrieveClauses(clauses, pair.question, 1);
    const actual = retrieved[0]?.heading ?? "";
    return {
      expected: pair.expectedCitationHeading,
      actual,
      ok: headingKey(actual) === headingKey(pair.expectedCitationHeading),
      grounding: retrieved[0]
        ? jaccardSimilarity(pair.question, `${retrieved[0].heading} ${retrieved[0].text}`)
        : 0,
    };
  });

  return { clauses, types, rules, citations };
}

export function runEval(): { clause: Metrics; rule: Metrics; citationAccuracy: number; meanGrounding: number } {
  let clauseTP = 0;
  let clauseFP = 0;
  let clauseFN = 0;
  let ruleTP = 0;
  let ruleFP = 0;
  let ruleFN = 0;
  let correctCitations = 0;
  let totalCitations = 0;
  const grounding: number[] = [];
  const perDocument: string[] = [];

  for (const contract of goldenSet) {
    const run = runDocument(contract.id);

    // Clause typing: match expected (heading, type) pairs against what the
    // real segmenter + resolveClauseType produced, in document order.
    let cursor = 0;
    for (const expected of contract.clauses) {
      const actualType = run.types[cursor];
      if (actualType === expected.expectedType) clauseTP += 1;
      else clauseFN += 1;
      cursor += 1;
    }
    clauseFP += Math.max(0, run.clauses.length - contract.clauses.length);

    for (const expectedRule of contract.expectedRules) {
      if (run.rules.includes(expectedRule)) ruleTP += 1;
      else ruleFN += 1;
    }
    for (const actualRule of run.rules) {
      if (!contract.expectedRules.includes(actualRule)) ruleFP += 1;
    }

    for (const citation of run.citations) {
      totalCitations += 1;
      if (citation.ok) correctCitations += 1;
      grounding.push(citation.grounding);
    }

    perDocument.push(
      `  ${contract.id} ${contract.name}: rules=[${run.rules.join(", ") || "none"}] expected=[${contract.expectedRules.join(", ") || "none"}]`,
    );
  }

  const clause = f1(clauseTP, clauseFP, clauseFN);
  const rule = f1(ruleTP, ruleFP, ruleFN);
  const citationAccuracy = totalCitations === 0 ? 0 : correctCitations / totalCitations;
  const meanGrounding = grounding.length === 0 ? 0 : grounding.reduce((a, b) => a + b, 0) / grounding.length;

  console.log("\n### Golden Set Evaluation");
  console.log(`Documents: ${goldenSet.length}   Rules in pack: ${packV1Rules().length}`);
  console.log(perDocument.join("\n"));
  console.log("\n| Metric | Value |");
  console.log("| :--- | :--- |");
  console.log(`| Clause Type Precision | ${(clause.precision * 100).toFixed(1)}% |`);
  console.log(`| Clause Type Recall | ${(clause.recall * 100).toFixed(1)}% |`);
  console.log(`| Clause Type F1 | ${(clause.f1 * 100).toFixed(1)}% |`);
  console.log(`| Rule Precision | ${(rule.precision * 100).toFixed(1)}% |`);
  console.log(`| Rule Recall | ${(rule.recall * 100).toFixed(1)}% |`);
  console.log(`| Rule F1 | ${(rule.f1 * 100).toFixed(1)}% |`);
  console.log(`| Citation Accuracy | ${(citationAccuracy * 100).toFixed(1)}% |`);
  console.log(`| Mean Grounding (Jaccard) | ${meanGrounding.toFixed(3)} |\n`);

  return { clause, rule, citationAccuracy, meanGrounding };
}

runEval();
