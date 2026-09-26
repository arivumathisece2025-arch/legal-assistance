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
- Token-bucket rate limiting; CSRF protection on the data-deletion route.
- Server-side PII redaction before any text reaches a model call.
- Hash-chained audit log with `GET /api/audit/verify` to detect tampering.
- `POST /api/data/delete` performs real deletes and reports what it purged.

### Efficiency
- Clause classification batches 25 clauses per model call
  (`lib/core/src/classify.ts`), so call count is `ceil(n / 25)`.
- In-memory BM25 retrieval: mean 0.019 ms per query, measured.
- `MOCK_LLM=1` runs the whole pipeline offline against recorded fixtures.

### Testing
- **133 tests, all passing**: 77 in `lib/core`, 56 in `api-server`. The runner is
  the Node test runner via `tsx --test`, not Vitest.
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
- `tsx --test`, Playwright, axe-core

## Setup

```bash
pnpm install
cp .env.example .env      # then set GROQ_API_KEY and APP_ENCRYPTION_KEY
pnpm test                 # 130 unit/integration tests
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
Changing it makes previously stored blobs undecryptable.

## Known gaps

Stated plainly, because a submission that hides these is weaker than one that
names them.

1. **Retrieval ceiling.** BM25 scores 93.3% citation accuracy on the golden set.
   The single miss is a synonym case ("change" vs "amend"), which lexical
   retrieval cannot resolve. The fixture is deliberately left failing rather
   than tuned. See [ADR 0001](docs/adr/0001-bm25-over-embeddings.md).
2. **CI is minimal.** `.github/workflows/secret-scan.yml` runs gitleaks over full
   history. There is no workflow yet that runs `pnpm test` and Playwright on
   every pull request.
3. **Audit log is in-memory.** The hash chain is lost on restart and is not
   shared across instances. Persisting it to the relational store is the next
   infrastructure task.
4. **Golden set scope.** Fixtures are two-clause documents, so they exercise rule
   and retrieval logic well but not segmentation of realistic 50-200 clause
   contracts.
5. **Secret rotation.** Groq keys previously committed to git history were
   rotated and revoked, but remain in the history. See the note in
   [THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Documentation
- [ADR 0001: BM25 over embeddings](docs/adr/0001-bm25-over-embeddings.md)
- [ADR 0002: Deterministic rules over LLM judgment](docs/adr/0002-deterministic-rules-over-llm-judgment.md)
- [ADR 0003: lib/core stays framework-free](docs/adr/0003-lib-core-stays-framework-free.md)
- [ADR 0004: TypeScript over Python](docs/adr/0004-typescript-over-python.md)
- [ADR 0005: No vector database](docs/adr/0005-no-vector-database.md)
- [GenAI services matrix](docs/GENAI_SERVICES.md)
- [Demo runbook](docs/DEMO_RUNBOOK.md)
- [Threat model](docs/THREAT_MODEL.md)
