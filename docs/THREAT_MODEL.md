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
| Session cookies | Carry a random session-scoped owner identity and CSRF token; they are not user authentication. |
| Audit chain | Evidence of what was handled and deleted. |

## Trust boundaries

1. **Browser → API** — untrusted; cross-origin requests are restricted by CORS and unsafe requests require the session CSRF header.
2. **API → Groq** — document text crosses to a third party after redaction.
3. **API → Postgres** — trusted network, untrusted content.
4. **API → operator** — logs and audit output are read by humans.

## STRIDE analysis

| Component | Threat | Mitigation | Status |
| :--- | :--- | :--- | :--- |
| Upload | Spoofing — malicious file masquerading as a contract | Magic-byte detection and 15 MiB cap; audio has a separate 5 MiB cap and MIME allowlist | Implemented |
| Upload | Tampering — PDF active content | Best-effort latin1 scan normalizes `#xx` names and rejects JavaScript/JS, `/ObjStm` with script, `/AA`, `/RichMedia`, `/XFA`, `/EmbeddedFile`, `/Launch`, and `/OpenAction`; this is not a sandbox | Best-effort filter |
| Ingestion | Information disclosure — PII reaching the LLM | `redactPii` runs before any provider call; rehydration map never leaves the server | Implemented |
| Ingestion | Prompt injection via document text | `scanInjection` flags instruction-override, base64 blobs, zero-width characters and white-on-white text; findings surface as `securityFindings` for human review | Implemented |
| Documents at rest | Information disclosure — stolen database | AES-256-GCM per upload, random 12-byte IV, key derived with the `blob-aes` HKDF label; startup rejects weak/placeholder keys in production | Implemented |
| Documents at rest | Tampering — altered ciphertext | AES-GCM authentication tags are stored with ciphertext, but no database decrypt/read path currently verifies them | Partial; reads remain in-memory |
| Session | Spoofing — forged identity | New sessions use random UUID identities; cookies are `base64url(payload).HMAC-SHA256` signed with the `session-hmac` HKDF label and verified in constant time | Implemented; not account authentication |
| Session | Tampering — CSRF | `GET /api/session` supplies a token bound to the signed session; every non-GET/HEAD/OPTIONS `/api` request requires the constant-time checked header | Implemented |
| Documents | Information disclosure — cross-user access | Document reads, asks, comparisons, and deletion are owner checked; inaccessible documents return 404; public seeds are read-only | Implemented |
| API | Denial of service — request flood | Token buckets keyed by limit/window/IP; stale full buckets are swept and the map is capped at 10,000; audio is limited to 10/minute and upstream requests time out after 30 seconds | Implemented per process |
| API | Information disclosure — missing headers | CSP, `nosniff`, `DENY`, referrer/permissions policies, COOP and CORP; inline styles are limited to style attributes for React | Implemented |
| Logs | Information disclosure — PII in logs | `redactMeta` replaces document text and prompts with a truncated SHA-256 digest; pino redacts `authorization` and `cookie` | Implemented |
| Audit log | Repudiation — hiding a deletion | Hash-chained events include hashed document IDs; when `DATABASE_URL` is set they are mirrored to `audit_log_entries`, reloaded and verified at startup; `/api/audit/verify` returns only `{valid, length}` | Implemented, best-effort persistence |

## Known gaps

These are deliberate and recorded rather than silently shipped.

- **Audit durability is best-effort.** With `DATABASE_URL`, entries are written
  asynchronously and reloaded/verified at startup. A process still owns its
  own chain, writes may be lost on abrupt termination or database failure, and
  the database is not configured as immutable/WORM storage.
- **Session ownership is not authentication.** A random UUID is assigned to an
  anonymous session, but there is no login/account recovery or identity provider.
  Clearing cookies loses access to that session's documents.
- **Document reads do not rehydrate from Postgres.** Encrypted uploads are
  inserted with `owner_id` and `expires_at`, but current reads use the in-memory
  map. After restart those records are not available through document routes
  until persistence-backed loading is implemented.
- **Rate limits are per-process.** Buckets are bounded and evicted, but are not
  shared across replicas; limits reset on deploy.
- **The PDF filter is not a sandbox.** It rejects recognized active-content
  markers after name normalization, but cannot guarantee safety for every PDF
  encoding or parser behavior.
- **HSTS is conditional.** It is only sent over HTTPS or in production, to
  avoid pinning `localhost` to HTTPS during local development.
- **Historical secret exposure is unresolved.** Credentials have appeared in
  git history, which has not been rewritten, and provider-side revocation has
  not been verified in this pass. Treat historical values as compromised and
  independently verify rotation/revocation; do not assume working-tree changes
  resolve exposure in repository history.

## Data retention and the DPDP Act 2023

- Raw document text is never written to a log. Only a truncated SHA-256 digest
  and a character count are recorded, which is enough to correlate requests
  without persisting the clause.
- Documents carry a 24-hour TTL (`expiresAt`); expired memory records are
  removed during access and by the scheduled sweep, and database rows are swept
  hourly when configured.
- `POST /api/data/delete` purges stored blobs and in-memory documents and
  writes a `DATA_DELETION_REQUEST` entry. Database deletion is scoped to
  `owner_id`; audit rows are intentionally
  **not** deleted: the record of an erasure request must outlive the data it
  describes, or the right to erasure becomes unauditable.
- The endpoint reports `documentsPurged`, `databaseRowsDeleted` and
  `databaseConfigured` rather than a blanket success, so a caller can tell
  the difference between "deleted" and "there was nothing to delete".