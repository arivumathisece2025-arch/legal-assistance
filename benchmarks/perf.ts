import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { parsePlainText } from "../lib/core/src/ingestion";
import { segmentDocument } from "../lib/core/src/segment";
import { evaluateRiskRules } from "../lib/core/src/rules/packV1";
import { retrieveClauses } from "../lib/core/src/retrieval";
import { MockProvider } from "../lib/core/src/llm/mock";
import { goldenSet, renderContractText } from "./fixtures/goldenSet";

const HERE = dirname(fileURLToPath(import.meta.url));
const ITERATIONS = 200;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const stats = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, p50: percentile(values, 50), p95: percentile(values, 95), max: Math.max(...values) };
};

const fmt = (value: number) => value.toFixed(3);

async function runPerf() {
  const segmentTimes: number[] = [];
  const ruleTimes: number[] = [];
  const retrievalTimes: number[] = [];
  const classifyTimes: number[] = [];

  // Real provider call timing. MockProvider reads from disk, so this measures
  // harness overhead only - it is NOT a model latency measurement.
  const provider = new MockProvider();
  const classificationSchema = {
    parse: (value: unknown) => value,
    safeParse: (value: unknown) => ({ success: true, data: value }),
    description: "clause-classification",
  } as never;

  let totalClauses = 0;
  let totalFindings = 0;
  let retrievalQueries = 0;

  for (const contract of goldenSet) {
    const text = renderContractText(contract);

    let clauses = segmentDocument(parsePlainText(text));
    totalClauses += clauses.length;

    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      clauses = segmentDocument(parsePlainText(text));
      segmentTimes.push(performance.now() - start);
    }

    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      totalFindings += evaluateRiskRules(clauses).length;
      ruleTimes.push(performance.now() - start);
    }

    for (const qa of contract.qaPairs) {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const start = performance.now();
        retrieveClauses(clauses, qa.question, 6);
        retrievalTimes.push(performance.now() - start);
      }
      retrievalQueries += 1;
    }

    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      await provider.completeJson("classify", JSON.stringify(clauses.map((c) => c.id)), classificationSchema);
      classifyTimes.push(performance.now() - start);
    }
  }

  const segment = stats(segmentTimes);
  const rules = stats(ruleTimes);
  const retrieval = stats(retrievalTimes);
  const classify = stats(classifyTimes);

  // Cost model, not a measurement: BATCH_SIZE in classify.ts is 25.
  const BATCH_SIZE = 25;
  const callsFor = (n: number) => Math.ceil(n / BATCH_SIZE);
  const twoClauseCalls = callsFor(2);
  const twoHundredClauseCalls = callsFor(200);

  const markdown = `# Benchmark Results

Generated: ${new Date().toISOString()}
Node: ${process.version}
Documents: ${goldenSet.length} golden contracts
Iterations per measurement: ${ITERATIONS}

All figures below are **measured** wall-clock timings of the real
\`segmentDocument\`, \`evaluateRiskRules\`, \`retrieveClauses\` and
\`MockProvider.completeJson\` implementations in \`lib/core\`. No values are
simulated or randomised.

| Metric | Mean (ms) | p50 (ms) | p95 (ms) | Max (ms) |
| :--- | ---: | ---: | ---: | ---: |
| parse + segment (2-clause doc) | ${fmt(segment.mean)} | ${fmt(segment.p50)} | ${fmt(segment.p95)} | ${fmt(segment.max)} |
| evaluateRiskRules (2-clause doc) | ${fmt(rules.mean)} | ${fmt(rules.p50)} | ${fmt(rules.p95)} | ${fmt(rules.max)} |
| retrieveClauses (BM25, 1 query) | ${fmt(retrieval.mean)} | ${fmt(retrieval.p50)} | ${fmt(retrieval.p95)} | ${fmt(retrieval.max)} |
| MockProvider.completeJson | ${fmt(classify.mean)} | ${fmt(classify.p50)} | ${fmt(classify.p95)} | ${fmt(classify.max)} |

## Derived

| Metric | Value |
| :--- | ---: |
| Clauses segmented (total, all docs) | ${totalClauses} |
| Rule findings (total, all docs) | ${totalFindings} |
| Retrieval queries measured | ${retrievalQueries} |
| LLM calls for a 2-clause doc | ${twoClauseCalls} |
| LLM calls for a 200-clause doc | ${twoHundredClauseCalls} |

\`classifyClauses\` batches at ${BATCH_SIZE} clauses per call
(\`lib/core/src/classify.ts\`), so call count grows as \`ceil(n / ${BATCH_SIZE})\`:
a 2-clause document costs 1 call and a 200-clause document costs ${twoHundredClauseCalls} calls.

## What these numbers do not say

- \`MockProvider\` performs a local file read, so its timing is harness
  overhead. It is **not** a model latency or token-cost measurement. Real
  \`GroqProvider\` latency requires a live \`GROQ_API_KEY\` and network access.
- TTFB, tokens-per-document and cold/warm cache timings are omitted rather
  than invented, because nothing in this repository measures them. A streaming
  endpoint would be needed to measure TTFB honestly.
- The golden documents are 2 clauses each, so per-document timings reflect
  that size, not a realistic 50-200 clause contract.
`;

  const outputPath = join(HERE, "RESULTS.md");
  writeFileSync(outputPath, markdown);
  console.log(markdown);
  console.log(`Written to ${outputPath}`);
}

runPerf().catch((error) => {
  console.error(error);
  process.exit(1);
});
