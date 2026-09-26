# ADR 0002: Deterministic rule engine over LLM judgment for risk scoring

## Status
Accepted

## Context
The "Risk Radar" identifies risky clauses such as an uncapped indemnity or an
over-long non-compete. That could be done by prompting a model to read the
contract and flag risks, or by a hardcoded deterministic rule engine.

## Decision
Use a deterministic TypeScript rule engine (`lib/core/src/rules/packV1.ts`,
14 rules) for all risk scoring. The LLM is not used to make legal judgments.
Date arithmetic in `lib/core/src/obligations.ts` is likewise computed in
TypeScript, not delegated to a model.

## Why
1. **Reproducibility.** A rule either fires or it does not. A model's risk
   assessment varies with temperature, model version, and prompt phrasing, which
   is unacceptable for a legal-adjacent tool.
2. **Auditability.** "Why is this flagged?" resolves to a named rule id and the
   exact predicate, not an opaque rationale that may be confabulated.
3. **Cost and latency.** The engine evaluates 14 rules over every clause in
   well under a millisecond and costs nothing. See `benchmarks/RESULTS.md` for
   measured timings.
4. **No hallucinated risk.** A model can invent a risk that is not in the text
   or miss one that is. A regex either matches the document or it does not.

## Alternatives considered
- **LLM-as-a-judge.** Rejected: fails the reproducibility and auditability
  requirements.
- **Hybrid (model proposes, rules verify).** Rejected as unnecessary complexity;
  the 14 rules cover the core risk surface without model involvement.

## Consequences
- **Maintenance cost.** A new risk pattern requires code and a test, not a prompt
  edit. This is a deliberate trade of agility for reproducibility.
- **Semantic blind spots.** The engine cannot catch novel, heavily contextual
  risks that match no known pattern. Accepted for reliability.
- **Rule gating depends on clause typing, so type resolution must not drift.**
  `evaluateRiskRules` gates every predicate on `appliesTo`, resolved through
  `resolveClauseType` in `lib/core/src/align.ts`. This was previously a private
  copy inside `packV1.ts` that had drifted: it required a literal "cap" to
  classify "Limitation of Liability", so `missing-liability-cap` could never fire
  in the real pipeline. The duplicate was deleted in favour of the shared
  resolver, and the case is pinned by a regression test in
  `lib/core/src/__tests__/rules-pack-v1.test.ts`. **Any future change to clause
  typing must re-run `pnpm run bench:eval`, which is what caught this.**

## Evidence
`pnpm run bench:eval` reports rule precision, recall, and F1 against a 14-document
golden set; `lib/core/src/__tests__/rules-pack-v1.test.ts` runs a positive and a
negative fixture for every rule in the pack.
