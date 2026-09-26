# ADR 0005: No vector database in the infrastructure

## Status
Accepted

## Context
A companion to [ADR 0001](0001-bm25-over-embeddings.md), recorded separately
because it is an infrastructure and operational decision rather than a
retrieval-algorithm decision. The two would be revisited together but fail for
different reasons.

## Decision
No vector database (pgvector, Pinecone, Weaviate, Qdrant, or similar) is part of
this system's infrastructure. Persistence is Drizzle ORM over a relational store;
retrieval is in-memory BM25 over the clause list already held for the active
document.

## Why
A vector database is another service to provision, secure, and keep available:
another connection string, another failure mode, another thing that can be down
during a live demo. The retrieval corpus is one contract's clauses at a time, not
a large corpus searched across many documents, so the operational cost has no
corresponding benefit. BM25 computed in-process has no external dependency to
fail and is trivially testable against plain fixture data.

## Alternatives considered
- **pgvector alongside the existing Drizzle setup.** Rejected: needs embedding
  generation, which is itself unavailable from the chosen provider (see ADR 0001),
  plus a schema migration for vector columns — for an improvement that does not
  materialise at single-document scale.
- **A managed vector database as a separate service.** Rejected outright: a new
  external dependency and a new secret, for a corpus of a few dozen clauses.

## Verifiable in this repository
No vector-database or embedding dependency appears in any `package.json`, and no
embedding client is imported anywhere in the TypeScript sources. Retrieval is
`lib/core/src/retrieval.ts`, which is a self-contained BM25 implementation with no
network calls.

## Consequences
- Retrieval cannot be down for a reason unrelated to the process: there is
  nothing external to be down.
- No embeddings are generated, stored, or leaked, so no derived data needs its own
  retention or erasure handling.
- **Revisit if the product shape changes.** Searching a large library of documents
  at once is where lexical retrieval degrades and a vector store starts to earn
  its cost. At that point ADR 0001 and this one should be reopened together, and
  the provider constraint that blocks embeddings will need solving first.
