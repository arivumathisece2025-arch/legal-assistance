# GenAI services used, and where

This table reflects the verified routing in the current repo: the provider is
constructed in [artifacts/api-server/src/routes/documents.ts](../artifacts/api-server/src/routes/documents.ts), where `GROQ_MODEL_SMART` is selected with a `GROQ_MODEL_FAST` fallback for the answering path and `versionDiffProvider` uses the smart model explicitly.

| Service | Env var | Called from | Purpose |
|---|---|---|---|
| Groq Chat Completions | `GROQ_MODEL_SMART` | `lib/core/src/answer.ts` | grounded document Q&A, constrained to retrieved clause spans |
| Groq Chat Completions | `GROQ_MODEL_SMART` | `lib/core/src/simplify.ts` | plain-language rewriting, English/Tamil/Hindi |
| Groq Chat Completions | `GROQ_MODEL_SMART` | `lib/core/src/obligations.ts` | obligation extraction; date arithmetic done in TypeScript |
| Groq Chat Completions | `GROQ_MODEL_SMART` | `lib/core/src/versionDiff.ts` | pair-scoped comparison narrative, only for changed pairs already flagged by the rule engine |
| Groq Chat Completions | `GROQ_MODEL_FAST` | `lib/core/src/classify.ts` | batched clause-type classification, `ceil(n/25)` calls per document |
| Groq Whisper-compatible transcription | `GROQ_MODEL_AUDIO` | `artifacts/api-server` audio/transcribe route | voice question input, English/Tamil/Hindi |
| Browser `SpeechSynthesis` API | n/a — not GenAI | frontend TTS | spoken readback, entirely client-side |

`lib/core/src/adviceGate.ts` is intentionally excluded from the GenAI count: it is a pure regex classifier over `ADVICE_PATTERNS`, makes zero LLM calls, and is used to decide whether a question is information-seeking or advice-seeking before retrieval.

## Prose summary

Clause Compass uses hosted LLM APIs via Groq (model: `llama-3.1-70b-versatile`
and a smaller fast-tier model, per `.env`) strictly for perception and language
tasks — never for legal judgment. All risk scoring, deadline arithmetic, and
inconsistency detection are computed by a deterministic TypeScript rule engine,
never by a model. Notably, the information-versus-advice gate makes zero LLM
calls at all — it is pure regex pattern matching, which is a stronger
determinism guarantee than originally planned, not a weaker one. Retrieval is
lexical (BM25), not embeddings-based, since Groq has no embeddings endpoint and
a single contract's clause count (2 clauses in the golden evaluation fixtures) is
small enough that lexical retrieval is both faster and reproducible. Every
generated answer is constrained to retrieved clause spans and post-verified
before display. PII (PAN, Aadhaar, mobile numbers, email, GSTIN, IFSC) is
redacted server-side before any document text reaches an LLM call.
