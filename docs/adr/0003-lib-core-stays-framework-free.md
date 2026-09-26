# ADR 0003: lib/core has zero imports from artifacts/*

## Status
Accepted

## Context
Domain logic (segmentation, classification, the rule engine, retrieval,
verification, obligations, exports, simplification, alignment) needs to be
testable in isolation and reusable regardless of which transport layer or
frontend calls into it.

## Decision
`lib/core` is a separate pnpm workspace package (plain pnpm workspaces —
no Turborepo) containing only pure TypeScript, with no imports from
`artifacts/api-server` or `artifacts/clause-compass`, and no framework
dependencies. This is enforced mechanically: an architecture test walks the
import graph and fails the build if `lib/core` ever imports from
`artifacts/*`.

## Why
Without this boundary, business logic tends to accumulate inside route
handlers, coupling it to Express's request/response shape and making it
slower to test. Keeping `lib/core` pure means every piece of domain logic —
the PII redactor, the injection scanner, every risk rule, the citation
verifier — has direct, dependency-free unit tests, using Node's built-in
test runner (`tsx --test`), not an external test framework. As of the last
verified run: 130 tests total (77 in `@workspace/core`, 53 in
`@workspace/api-server`), all passing.

## Alternatives considered
- **Logic inline in Express route handlers**: rejected — the default
  failure mode for API-first projects, explicitly avoided from the
  reconciliation step that consolidated this repo onto one stack.
- **A services/ layer importing both core and Express**: this exists for
  wiring only — routes call into `lib/core` functions, but `lib/core`
  never imports back.

## Consequences
Every new domain feature is added to `lib/core` first, as a pure function
with its own tests, before being wired into a route.
