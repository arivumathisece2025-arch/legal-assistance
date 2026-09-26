import type { Clause } from "../segment";
import type { ClauseType } from "../classify";
import { resolveClauseType } from "../align";

export type RiskSeverity = "low" | "medium" | "high";
export type RiskPerspective = "partyA" | "partyB" | "both";

export type RiskClause = Clause & {
  type?: ClauseType | string;
};

export type RiskRule = {
  id: string;
  title: string;
  severity: RiskSeverity;
  appliesTo: readonly ClauseType[];
  predicate: (clause: RiskClause, clauses: RiskClause[]) => boolean;
  explanationTemplate: string;
  askYourLawyer: string;
  perspective: RiskPerspective;
};

export type RiskFinding = {
  ruleId: string;
  title: string;
  severity: RiskSeverity;
  clauseId: string;
  clauseHeading: string;
  clauseText: string;
  perspective: RiskPerspective;
  explanation: string;
  askYourLawyer: string;
};

export type RiskProfile = {
  perspective: RiskPerspective;
  findings: RiskFinding[];
  riskScore: number;
};

/**
 * Rule gating uses the same resolver as the rest of the pipeline.
 *
 * This used to be a second, private copy of the heuristic list. The two copies
 * drifted: packV1's version required a literal "cap" to recognise
 * "Limitation of Liability" as a liability cap, while `align.ts` resolved the
 * same heading correctly. Because `appliesTo` gates every predicate, a clause
 * typed `other` here meant rules like `missing-liability-cap` could never fire,
 * and the drift was invisible until the golden set exercised it.
 */
function getClauseType(clause: RiskClause): ClauseType {
  return resolveClauseType(clause);
}

function textOf(clause: RiskClause): string {
  return `${clause.heading}\n${clause.text}`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function clauseExistsInDoc(clause: RiskClause, clauses: RiskClause[], maybeIdLike: string): boolean {
  const normalized = normalize(maybeIdLike);
  return clauses.some((candidate) => {
    const idMatch = normalize(candidate.id) === normalized;
    const ordinalMatch = normalize(candidate.ordinal) === normalized;
    const headingMatch = normalize(candidate.heading).includes(normalized) || normalized.includes(normalize(candidate.heading));
    return idMatch || ordinalMatch || headingMatch;
  }) || clause.heading.toLowerCase().includes(normalized) || clause.text.toLowerCase().includes(normalized);
}

function explain(rule: RiskRule, clause: RiskClause): string {
  return rule.explanationTemplate
    .replaceAll("{clauseHeading}", clause.heading)
    .replaceAll("{clauseId}", clause.id)
    .replaceAll("{heading}", clause.heading);
}

export function packV1Rules(): RiskRule[] {
  return [
    {
      id: "uncapped-indemnity",
      title: "Uncapped indemnity",
      severity: "high",
      appliesTo: ["indemnity"],
      predicate: (clause) => /indemnif(y|ies|ication).*?(without|not.*cap|uncapped|no limit|no cap)/i.test(textOf(clause)) || /no.*cap|uncapped|without.*limit/i.test(textOf(clause)),
      explanationTemplate: "The indemnity in {clauseHeading} is uncapped, which can leave the counterparty exposed to open-ended losses.",
      askYourLawyer: "Should the indemnity be capped, limited to direct losses, and carve-out to the value of the services or the contract?",
      perspective: "partyB",
    },
    {
      id: "missing-liability-cap",
      title: "Missing or low liability cap",
      severity: "high",
      appliesTo: ["liability_cap"],
      predicate: (clause) => {
        const text = textOf(clause);
        const capValue = /(?:\$\s*\d[\d,]*|\d[\d,]*\s*(?:usd|inr|eur|gbp)|\b(?:\d+|one hundred thousand|one million)\b)/i.exec(text)?.[0] || "";
        const exceedsLowThreshold = /\b(?:not exceed|limited to|capped at|shall not exceed)\b.*(?:\$\s*\d[\d,]*|\d[\d,]*\s*(?:usd|inr|eur|gbp))/i.test(text) && /\$?\d[\d,]*/.test(capValue) && Number(capValue.replace(/[^0-9]/g, "")) < 100000;
        return /no cap|without limit|uncapped|no liability cap|not to exceed/i.test(text) || exceedsLowThreshold;
      },
      explanationTemplate: "The liability cap in {clauseHeading} is missing or unusually low relative to the commercial risk in the document.",
      askYourLawyer: "What is the real commercial exposure, and does the liability cap reflect the value of the engagement and the likely loss profile?",
      perspective: "partyB",
    },
    {
      id: "non-compete-excessive-duration",
      title: "Non-compete with no or excessive duration",
      severity: "high",
      appliesTo: ["non_compete"],
      predicate: (clause) => {
        const text = textOf(clause);
        const hasDuration = /(for|during)\s+\d+\s*(?:months?|years?)/i.test(text);
        const excessiveDuration = /(for|during)\s+(?:2[5-9]|[3-9]\d|[1-9]\d{2,})\s*(?:months?|years?)|(?:3|4|5|6|7|8|9|10|11|12)\s*years?/i.test(text);
        return /non[- ]?compete/i.test(text) && (!hasDuration || excessiveDuration);
      },
      explanationTemplate: "The non-compete in {clauseHeading} is indefinite or lasts beyond the 24-month norm expected for a standard engagement.",
      askYourLawyer: "Is the restraint duration commercially necessary, and can it be narrowed to the actual customer, geography, and role?",
      perspective: "partyA",
    },
    {
      id: "auto-renewal-short-notice",
      title: "Auto-renewal with short notice",
      severity: "medium",
      appliesTo: ["auto_renewal"],
      predicate: (clause) => /auto(?:matic)?[- ]?renew|renew(?:al)?/i.test(textOf(clause)) && /(?:less than|under|within)\s*(?:30|21|14|10|7|5)\s*days|\b(?:15|10|7|5)\s*days?\b/i.test(textOf(clause)),
      explanationTemplate: "The auto-renewal clause in {clauseHeading} can lock the relationship in after a very short notice window.",
      askYourLawyer: "What notice period would be reasonable to stop or renegotiate renewal before the term extends automatically?",
      perspective: "partyB",
    },
    {
      id: "arbitration-outside-india",
      title: "Arbitration seated outside India",
      severity: "medium",
      appliesTo: ["arbitration"],
      predicate: (clause) => /arbitration/i.test(textOf(clause)) && /(?:singapore|london|new york|dubai|paris|outside india|not in india|seat.*(?:singapore|london|new york))/i.test(textOf(clause)),
      explanationTemplate: "The arbitration clause in {clauseHeading} seats the dispute outside India, which changes procedural cost and familiarity.",
      askYourLawyer: "Do we want a neutral forum and are there cost, convenience, or enforceability implications from a non-Indian seat?",
      perspective: "partyA",
    },
    {
      id: "unilateral-amendment-rights",
      title: "Unilateral amendment rights",
      severity: "high",
      appliesTo: ["other", "jurisdiction"],
      predicate: (clause) => /amend(?:ment|ed)?\s+(?:this agreement|any provision)|may amend.*at any time|amend.*without consent|without notice.*amend/i.test(textOf(clause)),
      explanationTemplate: "The amendment mechanism in {clauseHeading} lets one party change the contract without the other party’s consent.",
      askYourLawyer: "Can we add a mutual consent requirement, notice period, and a cap on changes so the contract remains predictable?",
      perspective: "partyB",
    },
    {
      id: "asymmetric-termination-rights",
      title: "Asymmetric termination rights",
      severity: "high",
      appliesTo: ["termination"],
      predicate: (clause) => /terminate for convenience|without cause|may terminate.*while.*may not|only.*may terminate/i.test(textOf(clause)),
      explanationTemplate: "The termination rights in {clauseHeading} are materially one-sided and give the counterparty a stronger exit right than the other side.",
      askYourLawyer: "Should both sides have comparable convenience termination rights and a matching notice period?",
      perspective: "partyA",
    },
    {
      id: "payment-over-60-days",
      title: "Payment terms over 60 days",
      severity: "medium",
      appliesTo: ["payment"],
      predicate: (clause) => {
        const text = textOf(clause);
        return /(pay|invoice|payment)/i.test(text) && /(sixty|60|90|120|180)\s*days?/i.test(text) && !/under\s*(?:30|45|60)\s*days?/i.test(text);
      },
      explanationTemplate: "The payment terms in {clauseHeading} push settlement beyond a standard 60-day window and increase working-capital strain.",
      askYourLawyer: "Can the payment schedule be shortened, what trigger events apply, and are there interest or late-payment penalties?",
      perspective: "partyA",
    },
    {
      id: "ip-assignment-overreaching",
      title: "IP assignment overreaches the engagement",
      severity: "high",
      appliesTo: ["ip_ownership", "assignment"],
      predicate: (clause) => /assign(?:ment)?\s+(?:all|any|all right|title and interest).*ip|all intellectual property|all inventions|work product.*owned|all know-how|all pre-existing materials/i.test(textOf(clause)),
      explanationTemplate: "The IP assignment in {clauseHeading} appears broader than the services being supplied and may capture work outside the engagement.",
      askYourLawyer: "Can the assignment be limited to work created specifically for this engagement and exclude pre-existing IP and tools?",
      perspective: "partyA",
    },
    {
      id: "confidentiality-no-end-date",
      title: "Confidentiality with no end date",
      severity: "medium",
      appliesTo: ["confidentiality"],
      predicate: (clause) => /confidential.*(permanent|forever|indefinite|without end date|no end date|no expiry|for all time|never expires)/i.test(textOf(clause)) || /shall remain confidential for all time/i.test(textOf(clause)),
      explanationTemplate: "The confidentiality duty in {clauseHeading} is indefinite, which can materially outlast the commercial relationship and create unexpected obligations.",
      askYourLawyer: "What is the sensible confidentiality period after termination and does the contract need a sunset for trade secrets and know-how?",
      perspective: "partyA",
    },
    {
      id: "governing-law-jurisdiction-mismatch",
      title: "Mismatched governing law and jurisdiction",
      severity: "medium",
      appliesTo: ["jurisdiction"],
      predicate: (clause) => {
        const text = textOf(clause);
        const lawMatch = /governed by the laws of ([A-Za-z]+)(?:[,.;]|\s|$)/i.exec(text)?.[1]?.trim();
        const courtMatch = /courts of ([A-Za-z]+)(?:[,.;]|\s|$)/i.exec(text)?.[1]?.trim();
        const lawValue = lawMatch?.toLowerCase();
        const courtValue = courtMatch?.toLowerCase();
        return !!lawValue && !!courtValue && lawValue !== courtValue;
      },
      explanationTemplate: "The governing law in {clauseHeading} and the chosen forum are out of sync, which can raise uncertainty in enforcement and dispute strategy.",
      askYourLawyer: "Is the governing law and forum choice aligned with the key obligations, enforcement, and business realities of the deal?",
      perspective: "both",
    },
    {
      id: "undefined-defined-term",
      title: "Undefined defined term",
      severity: "medium",
      appliesTo: ["other", "jurisdiction", "payment"],
      predicate: (clause) => {
        const text = textOf(clause);
        const matches = text.match(/\b[A-Z]{3,}\b/g) || [];
        return matches.some((token) => !/^(THE|THIS|PARTY|PARTIES|TERMS|AGREEMENT|INDIA|LAW|COURTS|SECTION|CLAUSE|NOTICE|SERVICE|PAYMENT)$/i.test(token)) && !/means\s+.*\b(?:\w+)\b/i.test(text);
      },
      explanationTemplate: "The clause {clauseHeading} uses capitalised terms without a clear definition, increasing ambiguity for the reader and a future dispute.",
      askYourLawyer: "Should the undefined terms be defined or replaced with express plain-English wording to avoid ambiguity?",
      perspective: "both",
    },
    {
      id: "cross-reference-to-missing-clause",
      title: "Cross-reference to a non-existent clause",
      severity: "medium",
      appliesTo: ["other", "jurisdiction", "payment"],
      predicate: (clause, clauses) => {
        const refs = Array.from(textOf(clause).matchAll(/(?:section|clause)\s+([A-Za-z0-9.]+)/gi)).map((match) => match[1].replace(/\.$/, ""));
        return refs.length > 0 && refs.some((ref) => !clauses.some((candidate) => {
          if (candidate.id === clause.id) return false;
          const refLower = normalize(ref);
          return normalize(candidate.id) === refLower || normalize(candidate.ordinal) === refLower || normalize(candidate.heading).includes(refLower) || normalize(candidate.text).includes(refLower);
        }));
      },
      explanationTemplate: "The text in {clauseHeading} points to a clause or section that does not appear in the document, which creates a drafting gap.",
      askYourLawyer: "Can the clause cross-reference be corrected to match the actual numbered sections and avoid drafting ambiguity?",
      perspective: "both",
    },
    {
      id: "data-sharing-unnamed-third-parties",
      title: "Data sharing with unnamed third parties",
      severity: "high",
      appliesTo: ["data_privacy"],
      predicate: (clause) => /share|disclose|transfer|third[- ]party|service provider|affiliate|partner/i.test(textOf(clause)) && !/(named|identified|specific|listed|identified third[- ]party|specific recipients)/i.test(textOf(clause)),
      explanationTemplate: "The data-sharing language in {clauseHeading} does not name the recipients or limits of disclosure, which can create privacy and compliance exposure.",
      askYourLawyer: "Which recipients receive personal data, what purpose applies, and what safeguards are required before any sharing occurs?",
      perspective: "partyB",
    },
  ];
}

export function evaluateRiskRules(clauses: RiskClause[], perspective: RiskPerspective = "both"): RiskFinding[] {
  const rules = packV1Rules().filter((rule) => {
    if (perspective === "both") return true;
    return rule.perspective === "both" || rule.perspective === perspective;
  });

  return clauses.flatMap((clause) =>
    rules
      .filter((rule) => rule.appliesTo.includes(getClauseType(clause)))
      .filter((rule) => rule.predicate(clause, clauses))
      .map((rule) => ({
        ruleId: rule.id,
        title: rule.title,
        severity: rule.severity,
        clauseId: clause.id,
        clauseHeading: clause.heading,
        clauseText: clause.text,
        perspective,
        explanation: explain(rule, clause),
        askYourLawyer: rule.askYourLawyer,
      })),
  );
}

export function evaluateDocumentRisk(clauses: RiskClause[], perspective: RiskPerspective = "both"): RiskProfile {
  const findings = evaluateRiskRules(clauses, perspective);
  const riskScore = Math.min(100, Math.max(0, findings.reduce((total, finding) => {
    const weights = { low: 10, medium: 20, high: 35 };
    return total + weights[finding.severity];
  }, 0)));

  return { perspective, findings, riskScore };
}

export const PACK_V1_RULES = packV1Rules();
