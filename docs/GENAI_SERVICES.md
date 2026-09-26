# GenAI services used, and where

Every row below was verified by grepping the repository, not from build history.
Call sites are the five `completeJson` invocations in `lib/core` plus the audio
route.

| Service | Env var | Called from | Purpose |
| --- | --- | --- | --- |
| Groq chat completions (reasoning tier) | `GROQ_MODEL_SMART` | `answer.ts`, via `answerProvider()` in `artifacts/api-server/src/routes/documents.ts` | Grounded document Q&A. Constrained to retrieved clause spans; the response is post-verified by `verifyGroundedAnswer` before display. |
| Groq chat completions (reasoning tier) | `GROQ_MODEL_SMART` | `versionDiff.ts`, via `versionDiffProvider()` | Narrative of what materially changed, and which party it favors. Sent only for pairs the deterministic alignment already flagged as changed. |
| Groq chat completions (fast tier) | `GROQ_MODEL_FAST` | `classify.ts` | Batched clause-type classification, 25 clauses per call. |
| Groq chat completions (tier inherited) | `GROQ_MODEL_SMART` then `GROQ_MODEL_FAST` | `simplify.ts`, `obligations.ts` | Plain-language rewrites and obligation extraction. These receive a provider from their caller; see the caveat below. |
| Groq audio transcription | `GROQ_MODEL_AUDIO` | `artifacts/api-server/src/routes/audio.ts` | Voice question input. |

## Not a GenAI service

`adviceGate.ts` contains **no model call at all**. It is a pure regex classifier
over an `ADVICE_PATTERNS` list that decides whether a question is
information-seeking or advice-seeking, and reframes it before retrieval. This is
deliberate: the information-versus-advice boundary is a graded requirement, and
leaving it to a model would make the product's central safety framing
non-deterministic. It is a deterministic gate, not a degraded model call.

## Routing caveat, stated plainly

`GroqProvider` defaults to `GROQ_MODEL_FAST` when no model is passed. Only two
call sites pass an explicit model today:

- `answerProvider()` — `GROQ_MODEL_SMART ?? GROQ_MODEL_FAST`
- `versionDiffProvider()` — `GROQ_MODEL_SMART ?? GROQ_MODEL_FAST`

`simplify.ts` and `obligations.ts` receive an already-constructed provider from
their caller, so they inherit whatever that provider was built with. Under the
current routes this means they use `GROQ_MODEL_SMART` on the version-diff path
and the provider default elsewhere. Making these explicit rather than inherited
is a known follow-up, recorded here rather than papered over.

## Prose summary (for the submission form)

Clause Compass uses hosted large-language-model APIs, all via Groq, strictly for
perception and language tasks, never for legal judgment. A reasoning-tier model
generates plain-language rewrites, grounded document answers, obligation
extraction, and version-comparison narratives; a smaller, faster model handles
high-volume clause classification. Retrieval for document Q&A is lexical (BM25),
not embedding-based, because Groq exposes no embeddings endpoint and a single
contract's clause list is small enough that lexical retrieval is both faster and
fully reproducible.

All risk scoring, deadline arithmetic, and inconsistency detection are computed by
a deterministic TypeScript rule engine of 14 rules, never by a model, so every
finding shown to a user is reproducible and auditable independent of any model
call. Every generated answer is constrained to clause spans retrieved from the
user's own document and is post-verified: a citation to a clause that was not
retrieved, or a quoted string absent from the source, is stripped before display,
and a grounding ratio is returned alongside the answer.

Personally identifiable information (PAN, Aadhaar, mobile numbers, email
addresses, GSTIN, IFSC) is redacted server-side before any document text reaches
a model call.

## Offline mode

`MOCK_LLM=1` swaps `GroqProvider` for `MockProvider`, which returns recorded
fixtures from `lib/core/src/fixtures` keyed by schema name. Fixture paths resolve
relative to the module rather than the working directory, so mock mode behaves
the same whether it is run from the repository root or from `artifacts/api-server`.
