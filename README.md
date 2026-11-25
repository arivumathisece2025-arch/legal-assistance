# Clause Compass

Clause Compass reads a contract, explains it in plain language, flags the clauses
worth a second look, and answers questions about it — but it never decides
anything for you.

Every risk score comes from a fixed rule, not a model guessing. Every answer is
checked against the document before you see it.

## Architecture

A pnpm workspace with a strict separation of concerns:

- **`lib/core`** — pure TypeScript domain logic: the PII redactor, injection
  scanner, rule engine (`rules/packV1.ts`), BM25 retrieval, citation verifier,
  clause segmentation, alignment and version diff. No framework dependencies and
  no imports from `artifacts/*`, enforced mechanically by
  `lib/core/src/__tests__/architecture.test.ts`.
- **`artifacts/api-server`** — Express 5 API. HTTP, multipart upload, Drizzle
  persistence, sessions, rate limiting. Wires requests into `lib/core`; holds no
  business logic.
- **`artifacts/clause-compass`** — React/Vite frontend.
- **`lib/api-spec`** — OpenAPI spec plus an Orval config that generates the
  typed client in `lib/api-client-react` and the Zod schemas in `lib/api-zod`.

## Features

### Code quality
- Pure core: domain logic is unit-tested without an HTTP server.
- Architecture boundary enforced by an import-graph test.
- Strict TypeScript across the workspace (TypeScript 5.9).

### Security
- HMAC-signed session cookies, `httpOnly` and `SameSite=Strict`.
- Session-scoped document ownership; token-bucket rate limiting and CSRF checks
  on every state-changing `/api` request.
- Server-side PII redaction before any text reaches a model call.
- Hash-chained audit log, optionally persisted when `DATABASE_URL` is configured;
  `/api/audit/verify` returns only validity and chain length.
- Caller-scoped `DELETE /api/documents/:id` and `POST /api/data/delete`; database
  deletion is scoped by `owner_id` when configured.

### Efficiency
- Clause classification of the measured 150-clause benchmark used 6 calls on
  first processing and 0 calls when the same clause text was processed again;
  see [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md).
- BM25 with a per-document index: measured mean retrieval time was 1.017 ms per
  query on the 150-clause benchmark document.
- The repeated-question benchmark made 1 provider call across 100 questions
  (99.00% answer-cache hit rate).
- The measured main JavaScript chunk is 354.37 KB, down from a 1,326.26 KB
  pre-splitting build.
- `MOCK_LLM=1` runs the pipeline offline through the mock provider.

### Testing
- **185 tests, all passing in the latest `pnpm test` run**: 98 in `lib/core`, 87
  in `api-server`. `scripts/run-tests.mjs` discovers source tests and invokes
  Node's test runner with `tsx`; the project does not use Vitest.
- Adversarial and security suites covering session forgery, CSRF, rate limits,
  audit tampering, and data deletion.
- **Golden set**: 14 synthetic contracts with hand-written answer keys
  (`benchmarks/`), scoring clause-type F1, rule precision/recall/F1, and citation
  accuracy against the real pipeline.
- Accessibility: `e2e/accessibility.spec.ts` runs 7 Playwright + axe-core tests
  against rendered content.

## Tech stack
- Node.js, TypeScript 5.9, pnpm workspaces
- Express 5, Zod, Drizzle ORM, Pino
- React, Vite, Tailwind CSS, Lucide
- Groq API (chat completions and audio transcription)
- Node's test runner with `tsx`, Playwright, axe-core

## Setup

```bash
pnpm install
cp .env.example .env      # set GROQ_API_KEY and replace the encryption-key placeholder
pnpm test                 # 185 unit/integration tests (latest verified count)
pnpm run bench:eval       # golden-set metrics
pnpm run bench:perf       # measured timings -> benchmarks/RESULTS.md
pnpm exec playwright test # accessibility e2e
pnpm test:e2e             # full e2e

# API
PORT=3000 pnpm --filter @workspace/api-server run dev
```

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`APP_ENCRYPTION_KEY` derives the AES-256-GCM key for stored document blobs.
Use at least 32 bytes (64 hex or 44 base64 characters); production startup
rejects the example placeholder. Changing it makes previously stored blobs
undecryptable.

## Known gaps

Stated plainly, because a submission that hides these is weaker than one that
names them.

1. **Retrieval ceiling.** BM25 measured 93.3% citation accuracy on the golden set
   both before and after the per-document index change.
   The single miss is a synonym case ("change" vs "amend"), which lexical
   retrieval cannot resolve. The fixture is deliberately left failing rather
   than tuned. See [ADR 0001](docs/adr/0001-bm25-over-embeddings.md).
2. **Audit durability is best-effort.** With `DATABASE_URL`, entries are
   mirrored to `audit_log_entries` and reloaded/verified at startup, but writes
   are fire-and-forget and each process still has its own chain. There is no
   cross-instance ordering or immutable/WORM database policy.
3. **Document restart recovery is incomplete.** Uploads write encrypted blobs
   when a database is configured, but the current document reads use the
   in-memory map and do not rehydrate those records after a process restart.
4. **Session identity is not authentication.** Each anonymous browser session
   receives a random identity for ownership isolation; there is no login or
   account recovery, so clearing the session loses access to that session's docs.
5. **Golden set scope.** Fixtures are two-clause documents, so they exercise rule
   and retrieval logic well but not segmentation of realistic 50-200 clause
   contracts.
6. **Secret history.** Credentials have appeared in git history, which has not
   been rewritten; this pass does not claim that historical exposure is
   resolved. Treat those values as exposed and verify provider-side revocation.
   See [THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Documentation
- [ADR 0001: BM25 over embeddings](docs/adr/0001-bm25-over-embeddings.md)
- [ADR 0002: Deterministic rules over LLM judgment](docs/adr/0002-deterministic-rules-over-llm-judgment.md)
- [ADR 0003: lib/core stays framework-free](docs/adr/0003-lib-core-stays-framework-free.md)
- [ADR 0004: TypeScript over Python](docs/adr/0004-typescript-over-python.md)
- [ADR 0005: No vector database](docs/adr/0005-no-vector-database.md)
- [GenAI services matrix](docs/GENAI_SERVICES.md)
- [Demo runbook](docs/DEMO_RUNBOOK.md)
- [Threat model](docs/THREAT_MODEL.md)
