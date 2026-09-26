# ADR 0005: No vector database in the infrastructure

## Status
Accepted

## Context
Companion to ADR 0001 (BM25 over embeddings), stated separately as an
infrastructure decision rather than a retrieval-algorithm decision.

## Decision
No vector database is part of this system's infrastructure. Persistence is
Drizzle ORM over a relational store; retrieval is in-memory BM25 per
document, computed fresh from that document's clause list.

## Why
A vector database is additional infrastructure to provision and keep
available — for a retrieval corpus that is "one contract's clauses at a
time" (the golden-set fixtures used for evaluation are 2 clauses each,
reflecting this scale), the operational cost has no matching benefit.
In-process BM25 has no external dependency to fail and is trivially
testable with fixture data.

## Alternatives considered
- **pgvector alongside the existing Postgres/Drizzle setup**: rejected —
  adds embedding generation (Groq has no embeddings endpoint, per ADR 0001)
  and a schema migration for a benefit that doesn't materialize at this
document scale.
- **A managed vector database as a separate service**: rejected — a new
  external dependency and secret for a hackathon-scale corpus.

## Consequences
If this system were extended to search across many documents at once
rather than one document at a time, this decision would need revisiting.
