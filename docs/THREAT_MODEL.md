# Threat Model: Clause-Compass

Scope: the API server (`artifacts/api-server`), the document ingestion and
analysis pipeline (`lib/core`), and data at rest. Written against the code as
it exists, not against an intended design.

## Assets

| Asset | Why it matters |
| :--- | :--- |
| Uploaded contract documents | Contain privileged and confidential terms; may include PII. |
| Extracted clauses and risk findings | Derived personal data under the DPDP Act 2023. |
| `APP_ENCRYPTION_KEY` | Compromise decrypts every stored blob. |
| `GROQ_API_KEY` | Third-party spend and access to the model gateway. |
| Session cookies | Identify the caller to the erasure and audit endpoints. |
| Audit chain | Evidence of what was handled and deleted. |

## Trust boundaries

1. **Browser → API** — fully untrusted. The SPA is a separate origin.
2. **API → Groq** — document text crosses to a third party after redaction.
3. **API → Postgres** — trusted network, untrusted content.
4. **API → operator** — logs and audit output are read by humans.

## STRIDE analysis

| Component | Threat | Mitigation | Status |
| :--- | :--- | :--- | :--- |
| Upload | Spoofing — malicious file masquerading as a contract | Magic-byte detection, 15 MB cap, rejection of `/JavaScript`, `/EmbeddedFile`, `/Launch`, `/OpenAction` in `lib/core/src/upload.ts` | Implemented |
| Upload | Tampering — PDF active content | Same active-content rejection; text extracted via pdf.js, never executed | Implemented |
| Ingestion | Information disclosure — PII reaching the LLM | `redactPii` runs before any provider call; rehydration map never leaves the server | Implemented |
| Ingestion | Prompt injection via document text | `scanInjection` flags instruction-override, base64 blobs, zero-width characters and white-on-white text; findings surface as `securityFindings` for human review | Implemented |
| Documents at rest | Information disclosure — stolen database | AES-256-GCM per upload, random 12-byte IV, key derived from `APP_ENCRYPTION_KEY` | Implemented |
| Documents at rest | Tampering — altered ciphertext | GCM authentication tag is verified on read | Implemented |
| Session | Spoofing — forged identity | Cookie is `base64url(payload).HMAC-SHA256`, verified in constant time; unsigned or tampered cookies are discarded | Implemented |
| Session | Tampering — CSRF | Double-submit token bound to the signed session, compared with `timingSafeEqual` | Implemented on `/api/data/delete` only — see gaps |
| API | Denial of service — request flood | Token-bucket limiter keyed on `req.ip`, with `trust proxy` enabled | Implemented |
| API | Information disclosure — missing headers | CSP, `nosniff`, `DENY`, referrer and permissions policies in `middlewares/securityHeaders.ts` | Implemented |
| Logs | Information disclosure — PII in logs | `redactMeta` replaces document text and prompts with a truncated SHA-256 digest; pino redacts `authorization` and `cookie` | Implemented |
| Audit log | Repudiation — hiding a deletion | Append-only hash chain; each entry commits to its predecessor; `GET /api/audit/verify` reports the first tampered index | Implemented, in-memory only |

## Known gaps

These are deliberate and recorded rather than silently shipped.

- **The audit chain is not durable.** It lives in process memory, so it is
  lost on restart and invisible to other instances. It is evidence of
  nothing until it is written to an append-only store. `GET /api/audit/verify`
  is exposed so a caller can see this rather than assume the log is sound.
- **CSRF protection covers one route.** `/api/data/delete` is guarded. The
  document, upload and question endpoints are not, because they currently
  authenticate by possession of a document id rather than by session, and a
  global check would reject the existing client. Close this by moving those
  routes onto session auth and then applying `csrfProtection` app-wide.
- **Erasure is not per-user.** `stored_documents` has no owner column, so
  `POST /api/data/delete` can only perform a full wipe. Adding a `user_id`
  column and scoping the delete is a schema migration.
- **Rate limiting is per-process.** Buckets are in memory, so limits reset on
  deploy and are not shared across replicas. A shared store is needed to make
  the limit meaningful under horizontal scale.
- **HSTS is conditional.** It is only sent over HTTPS or in production, to
  avoid pinning `localhost` to HTTPS during local development.
- **Secret rotation is complete locally; provider-side revocation is unverified.**
  Two Groq API keys and `APP_ENCRYPTION_KEY` were exposed in git history via
  `.env.example`, which is deliberately tracked (`.gitignore` whitelists it with
  `!.env.example`) and therefore cannot be treated as a secret store. All values
  have been replaced in the working tree and `.env` is gitignored, but the
  exposed keys remain in published history until they are revoked at the
  provider. Until that revocation is confirmed, treat those keys as live and
  rotate any other credential that shared them. History has deliberately **not**
  been rewritten: revocation is the control that matters, and a force-push breaks
  every existing clone. A CI secret scan now blocks new matches.

## Data retention and the DPDP Act 2023

- Raw document text is never written to a log. Only a truncated SHA-256 digest
  and a character count are recorded, which is enough to correlate requests
  without persisting the clause.
- Uploads carry a 24-hour TTL (`expiresAt`), and expired rows are swept before
  each insert.
- `POST /api/data/delete` purges stored blobs and in-memory documents and
  writes a `DATA_DELETION_REQUEST` entry. Audit rows are intentionally
  **not** deleted: the record of an erasure request must outlive the data it
  describes, or the right to erasure becomes unauditable.
- The endpoint reports `documentsPurged`, `databaseRowsDeleted` and
  `databaseConfigured` rather than a blanket success, so a caller can tell
  the difference between "deleted" and "there was nothing to delete".