# Benchmark Results

Generated: 2026-11-25T15:02:19.489Z
Node: v20.20.0
Machine: win32 10.0.19045 (x64); Intel(R) Core(TM) i5-10310U CPU @ 1.70GHz
Source: 150 clauses generated from 14 golden contracts
Iterations per measurement: 200

Timings are measured wall-clock values for the same in-memory 150-clause
document. The deterministic provider is a test double; provider timings are
not treated as model latency.

| Metric | Mean (ms) | p50 (ms) | p95 (ms) | Max (ms) |
| :--- | ---: | ---: | ---: | ---: |
| parse + segment (150 clauses) | 0.485 | 0.353 | 0.710 | 5.358 |
| evaluateRiskRules (150 clauses) | 75.981 | 71.210 | 99.106 | 140.069 |
| buildRetrievalIndex (150 clauses) | 2.991 | 2.435 | 5.853 | 8.727 |
| retrieveFromIndex (one query) | 1.017 | 0.772 | 2.175 | 9.888 |

## Measured counts

| Metric | Value |
| :--- | ---: |
| Segmented clauses | 150 |
| Classification calls on first pass | 6 |
| Classification calls on identical cached pass | 0 |
| Answer-cache repeated-question runs | 100 |
| Answer-cache provider calls | 1 |
| Answer-cache hits | 99 |
| Answer-cache misses | 1 |
| Answer-cache hit rate | 99.00% |

Classification is made in 25-clause batches; the reported call counts are
observed calls from the benchmark provider spy. Cache hit rate is observed
from the exported answer-cache statistics for the repeated-question run.
