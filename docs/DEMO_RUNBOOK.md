# Demo runbook — Clause Compass

Target: 4–5 minutes. Rehearse the sequence at least once before judging; timing
gaps are where live demos fall apart.

## Before you start

- Confirm `GROQ_API_KEY`, `GROQ_MODEL_SMART`, `GROQ_MODEL_FAST`, and
  `GROQ_MODEL_AUDIO` are set **in the environment the server runs in**, not just
  in a local `.env`. The API refuses to start without `PORT`; the Q&A path
  surfaces a missing key as a 500, not a silent empty answer.
- Have two versions of one fixture contract ready for the Version Diff step, and
  a contract with a genuinely uncapped indemnity so the Risk Radar has something
  real to show rather than an empty list.
- **Network fallback:** set `MOCK_LLM=1` and restart. This is verified working —
  fixtures resolve relative to the module, so mock mode behaves the same from the
  repo root or from `artifacts/api-server`. Say it out loud to judges rather than
  letting the app degrade quietly: "we're in offline mode using recorded
  fixtures; here's what the live version returns" is a strong, honest recovery.

## Routes (wouter, in `artifacts/clause-compass/src/App.tsx`)

| Path | Screen |
| --- | --- |
| `/` | Upload / document list |
| `/documents/:id` | Clause Atlas, Risk Radar, Ask the Document |
| `/documents/:id/brief` | Lawyer Prep Brief |
| `/documents/:id/compare` | Version Diff |
| `/accessibility` | Accessibility statement |

## Script

**0:00–0:30 — The pitch**
"Clause Compass reads a contract, explains it in plain language, flags the clauses
worth a second look, and answers questions about it — but it never decides anything
for you. Every risk score comes from a fixed rule, not a model guessing, and every
answer is checked against the document before you see it."

**0:30–1:15 — Upload and Clause Atlas**
Upload the prepared contract. Show the parsed clause outline and the clause-type
classification. Mention batching: one call classifies 25 clauses, so call count is
`ceil(n / 25)`.

**1:15–2:15 — Risk Radar**
Open the findings. Pick one — ideally the uncapped indemnity — and read its
explanation and its `askYourLawyer` question aloud. Toggle the Party A / Party B
perspective and show the profile change. Say explicitly: "this list came from a
rule, not the model" and name the rule id. The pack is 14 rules in
`lib/core/src/rules/packV1.ts`.

**2:15–3:15 — Ask the Document**
Ask a real question ("what happens if I want to end this early?"). Show the
answer, the inline citation, and the grounding ratio. Then ask something the
document genuinely does not answer and show the honest refusal — that demonstrates
the anti-hallucination guarantee far better than a good answer does. Be aware
that BM25 has a lexical ceiling: a synonym question ("who can *change* the
agreement?") can retrieve the wrong clause. If it comes up, own it — it is
measured at 93.3% citation accuracy on the golden set and written up in ADR 0001.

**3:15–3:45 — Lawyer Prep Brief**
Open `/documents/:id/brief`. Emphasise it is built from the same risk findings
already on screen, not a second generation — one source of truth.

**3:45–4:30 — Version Diff (if time allows)**
Upload the second version at `/documents/:id/compare`. Show the side-by-side view
with changes-only filtering. Point at a "Changed — favors other party" label and
note that no finding is conveyed by colour alone.

**4:30–5:00 — Accessibility, if asked**
Open `/accessibility` directly rather than describing it from memory. The
dyslexia-friendly font toggle (Atkinson Hyperlegible, persisted under
`localStorage["dyslexia-font"]`) is a visible, one-click demonstration. Severity
badges read Information, Warning, or Critical in text **and** carry a lucide icon,
so nothing depends on colour perception. `prefers-reduced-motion` and
`prefers-color-scheme` are honoured in `index.css`.

**Close**
"Everything you saw — the risk scores, the deadlines, the flagged
inconsistencies — comes from deterministic code. The model's job is explaining
and drafting language at the user's reading level. That split is the point."

## If something breaks

- **Blank risk list.** The uploaded contract contains no clause matching one of
  the 14 rules. Use the prepared fixture, not an improvised upload.
- **Q&A returns 500.** `GROQ_API_KEY` is not set in this environment. Fall back to
  `MOCK_LLM=1`, restart, and restate that you are in offline mode.
- **Q&A returns 404 "Document not found"** on a document you just uploaded: that
  message now means a genuine lookup miss. Other failures report 500 with the real
  message, so a 404 is safe to trust.
- **A judge asks about the model being "unreliable."** Concede the lexical
  retrieval limit, point at the deterministic rule engine, and note that risk
  scoring never touches a model.
