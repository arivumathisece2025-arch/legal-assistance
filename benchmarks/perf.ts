import { writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { answerQuestion } from "../lib/core/src/answer";
import { clearCache, getCacheStats } from "../lib/core/src/cache";
import { classifyClauses } from "../lib/core/src/classify";
import { parsePlainText } from "../lib/core/src/ingestion";
import type { LLMProvider } from "../lib/core/src/llm/base";
import { buildRetrievalIndex, retrieveFromIndex } from "../lib/core/src/retrieval";
import { evaluateRiskRules } from "../lib/core/src/rules/packV1";
import { segmentDocument } from "../lib/core/src/segment";
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
  const indexBuildTimes: number[] = [];
  const retrievalTimes: number[] = [];
  const fixtureClauses = goldenSet.flatMap((contract) => segmentDocument(parsePlainText(renderContractText(contract))));
  if (!fixtureClauses.length) throw new Error("Golden fixtures did not produce any clauses.");

  const documentText = Array.from({ length: 150 }, (_, index) => {
    const source = fixtureClauses[index % fixtureClauses.length]!;
    const text = source.text.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, "").replace(/\s+/g, " ").trim();
    return `${index + 1}. ${source.heading}\n${text} Performance fixture clause ${index + 1}.`;
  }).join("\n\n");
  const parsedDocument = parsePlainText(documentText);
  const clauses = segmentDocument(parsedDocument);
  if (clauses.length !== 150) throw new Error(`Expected 150 benchmark clauses, got ${clauses.length}.`);

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    let start = performance.now();
    segmentDocument(parsePlainText(documentText));
    segmentTimes.push(performance.now() - start);

    start = performance.now();
    evaluateRiskRules(clauses);
    ruleTimes.push(performance.now() - start);

    start = performance.now();
    buildRetrievalIndex(clauses);
    indexBuildTimes.push(performance.now() - start);
  }

  const retrievalIndex = buildRetrievalIndex(clauses);
  const questions = goldenSet.flatMap((contract) => contract.qaPairs.map((pair) => pair.question));
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const question = questions[iteration % questions.length] ?? "What are the obligations?";
    const start = performance.now();
    retrieveFromIndex(retrievalIndex, question, 6);
    retrievalTimes.push(performance.now() - start);
  }

  let classificationCalls = 0;
  let answerCalls = 0;
  const provider: LLMProvider = {
    modelLabel: "benchmark-deterministic-provider",
    async completeJson<T>(_system: string, user: string, schema): Promise<T> {
      if (schema.description === "clause-classification") {
        classificationCalls += 1;
        const batch = JSON.parse(user) as Array<{ id: string; text: string }>;
        return schema.parse({
          items: batch.map(({ id, text }) => ({ clauseId: id, type: "other", severity: "low", summary: text.slice(0, 100) })),
        });
      }
      answerCalls += 1;
      return schema.parse({ answer: "The clause describes the parties’ obligations. [C1]" });
    },
  };

  clearCache();
  await classifyClauses(provider, clauses);
  const classificationCallsFirstPass = classificationCalls;
  await classifyClauses(provider, clauses);
  const classificationCallsOnCachedPass = classificationCalls - classificationCallsFirstPass;

  clearCache();
  const repeatedQuestionCount = 100;
  for (let iteration = 0; iteration < repeatedQuestionCount; iteration += 1) {
    await answerQuestion(
      "What obligations does this clause create?",
      clauses,
      provider,
      "en",
      { cacheScope: "benchmark-150-clause-document", perspective: "party_a" },
    );
  }
  const answerCacheStats = getCacheStats();
  const answerCacheHitRate = answerCacheStats.hits / (answerCacheStats.hits + answerCacheStats.misses);

  const segment = stats(segmentTimes);
  const rules = stats(ruleTimes);
  const indexBuild = stats(indexBuildTimes);
  const retrieval = stats(retrievalTimes);
  const cpu = os.cpus()[0]?.model ?? "unknown CPU";
  const machine = `${os.platform()} ${os.release()} (${os.arch()}); ${cpu}`;

  const markdown = `# Benchmark Results

Generated: ${new Date().toISOString()}
Node: ${process.version}
Machine: ${machine}
Source: 150 clauses generated from ${goldenSet.length} golden contracts
Iterations per measurement: ${ITERATIONS}

Timings are measured wall-clock values for the same in-memory 150-clause
document. The deterministic provider is a test double; provider timings are
not treated as model latency.

| Metric | Mean (ms) | p50 (ms) | p95 (ms) | Max (ms) |
| :--- | ---: | ---: | ---: | ---: |
| parse + segment (150 clauses) | ${fmt(segment.mean)} | ${fmt(segment.p50)} | ${fmt(segment.p95)} | ${fmt(segment.max)} |
| evaluateRiskRules (150 clauses) | ${fmt(rules.mean)} | ${fmt(rules.p50)} | ${fmt(rules.p95)} | ${fmt(rules.max)} |
| buildRetrievalIndex (150 clauses) | ${fmt(indexBuild.mean)} | ${fmt(indexBuild.p50)} | ${fmt(indexBuild.p95)} | ${fmt(indexBuild.max)} |
| retrieveFromIndex (one query) | ${fmt(retrieval.mean)} | ${fmt(retrieval.p50)} | ${fmt(retrieval.p95)} | ${fmt(retrieval.max)} |

## Measured counts

| Metric | Value |
| :--- | ---: |
| Segmented clauses | ${clauses.length} |
| Classification calls on first pass | ${classificationCallsFirstPass} |
| Classification calls on identical cached pass | ${classificationCallsOnCachedPass} |
| Answer-cache repeated-question runs | ${repeatedQuestionCount} |
| Answer-cache provider calls | ${answerCalls} |
| Answer-cache hits | ${answerCacheStats.hits} |
| Answer-cache misses | ${answerCacheStats.misses} |
| Answer-cache hit rate | ${(answerCacheHitRate * 100).toFixed(2)}% |

Classification is made in 25-clause batches; the reported call counts are
observed calls from the benchmark provider spy. Cache hit rate is observed
from the exported answer-cache statistics for the repeated-question run.
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
