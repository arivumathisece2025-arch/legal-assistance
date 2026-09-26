# ADR 0004: TypeScript/Express, not Python/FastAPI

## Status
Accepted (superseding an earlier decision)

## Context
The build initially started from a Python/FastAPI specification. Inspection
of the actual Replit workspace showed it was not a blank repository: it was
a pre-existing Replit Apps scaffold — a pnpm workspace with an Express 5
API, a React app, Drizzle ORM, Zod validation, and an Orval-generated typed
client from an OpenAPI spec. `replit.md`, already present in the repo,
described this TypeScript vertical slice as the intended foundation.

## Decision
Consolidate entirely on the existing TypeScript stack (plain pnpm
workspaces, TypeScript ~5.9.3, no Turborepo). Port the already-working
Python logic (PII redaction with Aadhaar Verhoeff checksum validation, the
injection scanner, the LLMProvider/GroqProvider/MockProvider split) into
`lib/core` as TypeScript, with its own tests, and delete the Python
`backend/` directory, `requirements.txt`, and virtual environment entirely.

## Why
Two backends serving the same product invites split routing, duplicated
validation, and deployment confusion under time pressure. The existing
TypeScript scaffold already had real accessibility groundwork in place.
Rebuilding it in Python would have cost time without improving the score,
and would have meant fighting Replit's own platform conventions rather than
using them.

## Alternatives considered
- **Force Python, delete the TypeScript scaffold**: rejected — would have
  discarded working accessibility groundwork and required rebuilding
  Replit's run/deploy wiring by hand.
- **Both stacks, Python as a microservice**: rejected — adds a network hop
  and a second dependency surface for no capability Python offered that
  TypeScript couldn't provide equally well over Groq's plain HTTP API.

## Consequences
Every piece of Python logic was re-verified after porting, not assumed
equivalent — this caught at least one real bug (a GSTIN matcher one
character short of the correct 15-character format) that a straight port
would likely have carried forward silently.
