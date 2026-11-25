# Clause Compass

Clause Compass is a pnpm TypeScript monorepo for contract review assistance. Its React frontend talks to an Express API, which uses framework-independent domain logic from `lib/core` for ingestion, clause analysis, grounded answers, simplification, and version comparison. It provides legal information and does not replace advice from a qualified lawyer.

## Stack and architecture

- Node.js, TypeScript, pnpm workspaces, Express 5, React, Vite, Zod, and Drizzle ORM.
- `lib/core` contains domain logic and has no imports from `artifacts/*`; `architecture.test.ts` enforces the boundary.
- `artifacts/api-server/src/routes` mounts API routers. Document behavior is split into `artifacts/api-server/src/documents/` modules for storage, upload, Q&A, comparison, and CRUD.
- The API uses session-scoped document ownership, CSRF checks on state-changing requests, rate limits, secure headers, and a hash-chained audit log. Database persistence is optional via `DATABASE_URL`; in-memory document records expire and are swept.
- `artifacts/clause-compass` is the React/Vite frontend. `lib/api-spec/openapi.yaml` is the API contract source for generated clients and schemas.

## Run and verify

- `pnpm --filter @workspace/api-server run dev` — start the API (set `PORT`, e.g. `PORT=3000`).
- `pnpm --filter @workspace/clause-compass run dev` — start the frontend.
- `pnpm run typecheck` — typecheck workspace packages.
- `pnpm test` — run the core and API-server test suites.
- `pnpm run bench:eval` and `pnpm run bench:perf` — run the evaluation and performance benchmarks.
- `pnpm exec playwright test` — run browser accessibility tests.
- `pnpm run build` — typecheck and build workspace packages.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients and schemas after OpenAPI changes.

Use `.env.example` as the environment-variable reference. `MOCK_LLM=1` selects the offline mock provider. Production deployments require a valid `APP_ENCRYPTION_KEY`; set `DATABASE_URL` only when database persistence is configured.

## Key files

- `lib/core/src/answer.ts`, `retrieval.ts`, and `verify.ts` — grounded Q&A pipeline.
- `lib/core/src/rules/packV1.ts` — deterministic risk rules.
- `artifacts/api-server/src/documents/` — document route implementation modules.
- `artifacts/api-server/src/lib/keys.ts` and `middlewares/` — key derivation and HTTP security controls.
- `artifacts/clause-compass/src/` — frontend application and styles.
- `docs/THREAT_MODEL.md` and `docs/SCORECARD.md` — security and rubric evidence.
