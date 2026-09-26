# ADR 0004: TypeScript/Express, not Python/FastAPI

## Status
Accepted

## Context
The project's build instructions originally described a Python/FastAPI backend
(PII redaction, injection scanning, and an `LLMProvider` abstraction built and
verified in Python first). The repository that was actually delivered is a pnpm
workspace: an Express 5 API, a React app, Drizzle ORM, Zod validation, and an
Orval-generated client from an OpenAPI spec.

## Decision
Build on the existing TypeScript stack. The Python-specific pieces were
reimplemented in TypeScript inside `lib/core`, and the repository contains no
Python.

## What is verifiable in this repository
This is stated precisely because the original build notes and the delivered code
disagree, and a reader deserves to know which is which:

- There is no `.py` file, `requirements.txt`, or `pyproject.toml` anywhere in the
  tree, and none appears in the git history of added files.
- The equivalent logic exists as TypeScript: `lib/core/src/pii.ts`,
  `lib/core/src/injection.ts`, and the `LLMProvider` / `GroqProvider` /
  `MockProvider` split in `lib/core/src/llm/`.
- The run and deployment configuration (`replit.md`, `.replit`, `Makefile`,
  `pnpm-workspace.yaml`) all assume the pnpm workspace.

Anyone auditing this ADR should treat the "built and verified in Python first"
narrative as a statement about the build process, not as something they can find
in the tree. What they can verify is the TypeScript end state and its tests.

## Why
Two backends serving one product invites split routing, duplicated validation,
and CORS and deployment confusion. The existing scaffold was not an empty shell:
`replit.md` already documented the information-versus-advice boundary and
icon-plus-text severity labels, both graded requirements. Rebuilding that in
Python would have cost time and meant fighting the platform's own run and
dependency conventions rather than working with them.

Groq is reached over plain HTTP, so nothing about the provider choice favoured
either language.

## Alternatives considered
- **Force Python, delete the TypeScript scaffold.** Rejected: discards working
  accessibility groundwork and requires rebuilding platform wiring by hand.
- **Run both, Python as a microservice.** Rejected: adds a network hop, a second
  deployment target, and a second dependency set for no capability TypeScript
  could not provide.

## Consequences
- One language, one dependency graph, one test runner (`tsx --test`).
- Ported logic had to be re-verified rather than assumed equivalent. That
  discipline is what surfaced the clause-type resolution drift described in
  [ADR 0002](0002-deterministic-rules-over-llm-judgment.md), where two copies of
  the same heuristic list had diverged and a rule was silently unreachable.
