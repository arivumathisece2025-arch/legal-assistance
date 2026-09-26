# ADR 0003: `lib/core` has zero imports from `artifacts/*`

## Status
Accepted

## Context
Domain logic (segmentation, classification, the rule engine, retrieval, citation
verification, obligations, simplification, alignment, and the PII and injection
guards) needs to be testable in isolation and reusable regardless of which
transport or UI calls into it.

## Decision
`lib/core` is a separate pnpm workspace package containing pure TypeScript with no
imports from `artifacts/api-server` or `artifacts/clause-compass`, and no
framework dependencies.

This is enforced mechanically, not by convention.
`lib/core/src/__tests__/architecture.test.ts` walks every `.ts` file under
`lib/core`, matches any `from "…artifacts/…"` or `import "…artifacts/…"`, and
fails with the list of offending files if any match:

```ts
assert.deepEqual(offenders, []);
```

## Why
Without the boundary, business logic accumulates inside route handlers. That
makes it slower to test — standing up an HTTP server to check a date-resolution
function — and harder to reuse, because the logic takes on Express's
request/response shape. Keeping the core pure means each piece of domain logic has
direct, fast, dependency-free unit tests.

The cost of the boundary is that provider selection lives outside the core. That
is where the Q&A regression came from: `answerQuestion` is pure and takes a
provider, but the route that builds that provider is not, and the route was
passing a stub. The architecture test could not have caught it, and a boundary
test should not be mistaken for a behaviour test.

## Alternatives considered
- **Logic inline in Express route handlers.** Rejected: the default failure mode
  for API-first projects, and the reason the rule engine and verifier are
  separately testable today.
- **A `services/` layer importing both core and Express.** Acceptable for wiring
  only. The route calls into `lib/core`; it does not reimplement anything, and
  the core never imports back.

## Consequences
- Every new domain feature is added to `lib/core` first, as a pure function with
  its own tests, then wired into a route.
- Anything needing environment or transport — a provider, a database handle, a
  request object — must be passed in. This is a real constraint and it is exactly
  the seam where the Q&A bug lived.
- The architecture test is cheap and runs in the ordinary `lib/core` suite, so
  the boundary cannot rot silently.
