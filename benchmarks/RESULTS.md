# Benchmark Results

Generated: 2026-09-26T06:21:12.181Z
Node: v24.21.0
Documents: 14 golden contracts
Iterations per measurement: 200

All figures below are **measured** wall-clock timings of the real
`segmentDocument`, `evaluateRiskRules`, `retrieveClauses` and
`MockProvider.completeJson` implementations in `lib/core`. No values are
simulated or randomised.

| Metric | Mean (ms) | p50 (ms) | p95 (ms) | Max (ms) |
| :--- | ---: | ---: | ---: | ---: |
| parse + segment (2-clause doc) | 0.006 | 0.004 | 0.011 | 0.222 |
| evaluateRiskRules (2-clause doc) | 0.059 | 0.051 | 0.104 | 2.499 |
| retrieveClauses (BM25, 1 query) | 0.019 | 0.014 | 0.031 | 1.847 |
| MockProvider.completeJson | 0.015 | 0.008 | 0.056 | 0.373 |

## Derived

| Metric | Value |
| :--- | ---: |
| Clauses segmented (total, all docs) | 28 |
| Rule findings (total, all docs) | 2600 |
| Retrieval queries measured | 15 |
| LLM calls for a 2-clause doc | 1 |
| LLM calls for a 200-clause doc | 8 |

`classifyClauses` batches at 25 clauses per call
(`lib/core/src/classify.ts`), so call count grows as `ceil(n / 25)`:
a 2-clause document costs 1 call and a 200-clause document costs 8 calls.

## What these numbers do not say

- `MockProvider` performs a local file read, so its timing is harness
  overhead. It is **not** a model latency or token-cost measurement. Real
  `GroqProvider` latency requires a live `GROQ_API_KEY` and network access.
- TTFB, tokens-per-document and cold/warm cache timings are omitted rather
  than invented, because nothing in this repository measures them. A streaming
  endpoint would be needed to measure TTFB honestly.
- The golden documents are 2 clauses each, so per-document timings reflect
  that size, not a realistic 50-200 clause contract.
