# Clause Compass

Clause Compass helps people understand contract language, spot review-worthy clauses, and prepare focused questions for a lawyer without making legal decisions for them.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/clause-compass run dev` — run the web app
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Storage: in-memory vertical slice for the first build
- Validation: Zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/clause-compass/src/App.tsx` — main inbox, document view, grounded Q&A, and accessibility route
- `artifacts/clause-compass/src/index.css` — Clause Compass visual language and responsive styles
- `artifacts/api-server/src/routes/documents.ts` — document workspace API and seeded analysis
- `artifacts/api-server/src/routes/questions.ts` — grounded question response path
- `lib/api-spec/openapi.yaml` — source of truth for the typed API contract

## Architecture decisions

- The first build uses the existing shared Express service and typed OpenAPI clients so the web app has a real vertical slice before the full Python analysis pipeline is added.
- The UI makes the information-versus-advice boundary visible throughout the workflow.
- Risk severity is communicated with icon and text labels in addition to color.

## Product

- Private contract inbox with upload metadata flow
- Clause-oriented document reading view with risk profile and document signals
- Grounded question area with citations and grounding ratio
- Accessibility statement and known limitations

## User preferences

No project-specific preferences recorded.

## Gotchas

- Run API codegen after every OpenAPI change.
- The generated client uses `Headers.entries()`, so `lib/api-client-react/tsconfig.json` must include `dom.iterable`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
