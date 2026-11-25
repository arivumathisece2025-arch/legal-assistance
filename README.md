# Clause Compass: PromptWars submission

## Problem statement

> Participants will take part in an online AI and prompt-based challenge in
> collaboration with PromptWars. They will demonstrate their ability to understand
> prompts, use AI tools effectively, think creatively, and solve assigned tasks.

**Assigned task:** a GenAI legal-information assistant that simplifies contracts,
flags risky clauses, compares versions and answers questions about a provided
document. It informs the user and never replaces legal advice.

## How this submission meets each part of the challenge

| Challenge skill | What I did | Where to see it |
| :--- | :--- | :--- |
| Understand prompts | Broke the task into 13 phased prompts (0-12). Each one fixes the stack, defines a "Done when" check, and ends with a rule to paste real command output. At runtime, system prompts restrict answers to retrieved clauses, require `[C#]` citations, and treat document text as data, not instructions. | [`docs/PROMPT_LOG.md`](docs/PROMPT_LOG.md), `lib/core/src/answer.ts`, `lib/core/src/adviceGate.ts` |
| Use AI tools effectively | Replit Agent built the app phase by phase. Groq models run in two tiers: a fast model for batched clause classification, a smart model for answers, simplification and comparison. Calls are batched (25 clauses per call), cached, retried and time-limited, and a mock provider runs the whole pipeline offline. | [`docs/GENAI_SERVICES.md`](docs/GENAI_SERVICES.md), [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md) |
| Think creatively | Risk scoring is deterministic code and the LLM only handles language ([ADR 0002](docs/adr/0002-deterministic-rules-over-llm-judgment.md)). A citation verifier strips unsupported claims. An advice gate turns "should I sign?" into an information question. Voice questions work in English, Tamil and Hindi. A hash-chained audit log detects tampering. The golden set keeps its one failing case instead of being tuned away. | [ADRs](docs/adr/), `lib/core/src/verify.ts` |
| Solve the assigned task | Upload and parse contracts (PDF, DOCX, text), plain-language simplification, risk flags, grounded Q&A with citations, version comparison, a Lawyer Prep Brief, and data deletion. | `lib/api-spec/openapi.yaml`, [`docs/SCORECARD.md`](docs/SCORECARD.md) |

## Where AI output was wrong and I corrected it

- The first prompts assumed Python/FastAPI. The workspace was a TypeScript
  scaffold, so I switched stacks deliberately ([ADR 0004](docs/adr/0004-typescript-over-python.md)).
- An AI-assisted review found shared anonymous identity, a public audit
  endpoint, CSRF on only one route and predictable document IDs. These were
  fixed and covered by tests.
- The self-audit found documentation claiming features that had no call
  site (simplify, classification). They were wired in and tested.
- Benchmarks were rerun after each change. Measured results replaced estimates.

## Verify it yourself

```bash
pnpm install && pnpm test && pnpm run bench:eval && pnpm exec playwright test
```


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
pnpm test                 # 162 unit/integration tests (latest verified count)
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
2. **CI is minimal.** `.github/workflows/secret-scan.yml` runs gitleaks over full
   history. There is no workflow yet that runs `pnpm test` and Playwright on
   every pull request.
3. **Audit durability is best-effort.** With `DATABASE_URL`, entries are
   mirrored to `audit_log_entries` and reloaded/verified at startup, but writes
   are fire-and-forget and each process still has its own chain. There is no
   cross-instance ordering or immutable/WORM database policy.
4. **Document restart recovery is incomplete.** Uploads write encrypted blobs
   when a database is configured, but the current document reads use the
   in-memory map and do not rehydrate those records after a process restart.
5. **Session identity is not authentication.** Each anonymous browser session
   receives a random identity for ownership isolation; there is no login or
   account recovery, so clearing the session loses access to that session's docs.
6. **Golden set scope.** Fixtures are two-clause documents, so they exercise rule
   and retrieval logic well but not segmentation of realistic 50-200 clause
   contracts.
7. **Secret history.** Credentials have appeared in git history, which has not
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
