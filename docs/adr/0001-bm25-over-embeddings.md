# ADR 0001: BM25 lexical retrieval over vector embeddings

## Status
Accepted

## Context
The "Ask the Document" feature must retrieve the most relevant clauses from an
uploaded contract so the model's answer is grounded in that document. The two
standard approaches are lexical retrieval (BM25/TF-IDF) and dense retrieval
(embeddings plus cosine similarity).

## Decision
Use in-memory BM25 retrieval over the segmented clauses of the active document
(`lib/core/src/retrieval.ts`). Do not generate or store vector embeddings.

## Why
1. **Provider constraints.** Groq, the provider this system uses, exposes chat
   completions and audio transcription but no embeddings endpoint. Dense
   retrieval would require a second provider, adding a network hop, another API
   secret, per-query cost, and a new failure mode.
2. **Corpus scale.** The retrieval corpus is bounded to one uploaded contract at
   a time. In-process BM25 is sub-millisecond, so the latency budget is not the
   constraint.
3. **Determinism.** BM25 is fully reproducible: the same query against the same
   clause list returns the same ranking every time, which matters for debugging
   and for a tool whose output is meant to be explainable.

## Alternatives considered
- **Dense retrieval via a second provider.** Rejected: a network hop, a second
  secret to manage, and per-query cost for a corpus small enough that lexical
  matching already performs well.
- **Hybrid (BM25 + embeddings).** Rejected as over-engineered for the current
  single-document scope.

## Consequences
- **Lexical gap, measured.** BM25 cannot resolve synonyms. The Phase 10 golden
  set scores **93.3% citation accuracy** (14 of 15 questions); the one miss asks
  "Who can change the agreement?" and retrieves the `Term` clause, because
  "change" has no lexical overlap with "amend".
- **This is a known accuracy ceiling, not a rounding error.** It is reported
  rather than tuned away, and the golden-set fixture is left failing so the gap
  stays visible.
- **Mitigation, if scope changes.** Query expansion (a small synonym map) or a
  provider with native embedding support. Revisit only if the product moves to
  searching across many documents at once.

## Evidence
Measured on this repository (`pnpm run bench:eval`); retrieval latency from
`pnpm run bench:perf`, mean 0.019 ms per query on a 2-clause document.
