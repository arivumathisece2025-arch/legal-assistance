# Demo runbook — Clause Compass

Target: 4-5 minutes. Rehearse once before judging.

## Before you start
- Confirm `GROQ_API_KEY`, `GROQ_MODEL_SMART`, `GROQ_MODEL_FAST`,
  `GROQ_MODEL_AUDIO` are set in the deployment environment.
- Have two versions of one fixture contract ready for the Version Diff
  step, and one contract with a genuinely uncapped indemnity clause.
- **Network fallback**: if venue wifi fails, set `MOCK_LLM=1` and restart
  the server. State this plainly to judges — "we're running in offline
  mode using recorded fixtures" is an honest recovery, not a weakness.

## Script

**0:00–0:30 — Pitch**
"Clause Compass reads a contract, explains it in plain language, flags the
clauses worth a second look, and answers questions about it — but it never
decides anything for you. Every risk score comes from a fixed rule, not a
model guessing."

**0:30–1:15 — Upload and Clause Atlas**
Upload the contract. Show the parsed clause outline and clause-type
classification. Mention it's batched — one call classifies 25 clauses.

**1:15–2:15 — Risk Radar**
Open the risk findings. Read one aloud with its `askYourLawyer` question.
Toggle perspective (Party A / Party B) and show the profile changing.

**2:15–3:15 — Ask the Document**
Ask a real question. Show the streaming answer, the inline citation, and
the grounding ratio. If time allows, ask something the document doesn't
cover and show the honest "the document doesn't address this" response.

**3:15–3:45 — Lawyer Prep Brief**
Show it's built from the same risk findings already displayed — one source
of truth, not a separate generation.

**3:45–4:30 — Version Diff**
Upload the second version. Show the changes-only filter and one "Changed —
favors other party" label — never color-only.

**4:30–5:00 — Close**
"Everything you saw — risk scores, deadlines, flagged inconsistencies —
comes from deterministic code, not the model. The model explains and
drafts; the rules decide."

## If something breaks live
- Blank risk list: use the prepared fixture, not an improvised upload.
- Q&A hangs: check `GROQ_API_KEY` is set in this environment; fall back to
  `MOCK_LLM=1` and say so.
- Accessibility question: open `/accessibility` directly.
