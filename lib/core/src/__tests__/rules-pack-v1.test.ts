import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDocumentRisk, evaluateRiskRules, packV1Rules } from "../rules/packV1";
import type { RiskClause } from "../rules/packV1";

function makeClause(
  id: string,
  heading: string,
  text: string,
  type: RiskClause["type"] = "other",
): RiskClause {
  return {
    id,
    ordinal: id.replace(/^C/, ""),
    heading,
    text,
    page: 1,
    charStart: 0,
    charEnd: text.length,
    type,
  };
}

const ruleIds = packV1Rules().map((rule) => rule.id);

for (const ruleId of ruleIds) {
  test(`${ruleId} positive fixture`, () => {
    const fixtures: Record<string, RiskClause[]> = {
      "uncapped-indemnity": [makeClause("C1", "Indemnification", "The Supplier shall indemnify the Customer without cap or limit for all losses.", "indemnity")],
      "missing-liability-cap": [makeClause("C2", "Liability cap", "The aggregate liability of either party shall not exceed $5,000.", "liability_cap")],
      "non-compete-excessive-duration": [makeClause("C3", "Non-compete", "The Consultant shall not compete for 36 months after termination.", "non_compete")],
      "auto-renewal-short-notice": [makeClause("C4", "Auto-renewal", "This agreement auto-renews for 15 days' notice before renewal.", "auto_renewal")],
      "arbitration-outside-india": [makeClause("C5", "Arbitration", "Any dispute will be settled by arbitration seated in Singapore.", "arbitration")],
      "unilateral-amendment-rights": [makeClause("C6", "Amendments", "The Supplier may amend this agreement at any time without prior notice or consent.", "other")],
      "asymmetric-termination-rights": [makeClause("C7", "Termination", "The Customer may terminate for convenience on 30 days' notice, but the Supplier may not terminate for convenience.", "termination")],
      "payment-over-60-days": [makeClause("C8", "Payment terms", "Invoices are payable within 90 days of receipt.", "payment")],
      "ip-assignment-overreaching": [makeClause("C9", "Intellectual property", "Each party assigns all intellectual property and inventions created in connection with this agreement to the other party.", "ip_ownership")],
      "confidentiality-no-end-date": [makeClause("C10", "Confidentiality", "Confidential Information shall remain confidential forever and without an end date.", "confidentiality")],
      "governing-law-jurisdiction-mismatch": [makeClause("C11", "Governing law", "This agreement is governed by the laws of India; the courts of Singapore shall have exclusive jurisdiction.", "jurisdiction")],
      "undefined-defined-term": [makeClause("C12", "Definitions", "The GRC shall perform the services. Customer operations rely on GRC for SLA compliance.", "other")],
      "cross-reference-to-missing-clause": [
        makeClause("C13", "Reference", "The parties agree to the obligations in Clause 42 and Section 9.3.", "other"),
      ],
      "data-sharing-unnamed-third-parties": [makeClause("C14", "Data sharing", "The company may share personal data with affiliates, service providers and third parties for processing and marketing.", "data_privacy")],
    };

    const findings = evaluateRiskRules(fixtures[ruleId] ?? [makeClause("C1", ruleId, ruleId)], "both");
    assert.ok(findings.some((finding) => finding.ruleId === ruleId), `${ruleId} should trigger on the positive fixture`);
  });

  test(`${ruleId} negative fixture`, () => {
    const fixtures: Record<string, RiskClause[]> = {
      "uncapped-indemnity": [makeClause("C1", "Indemnification", "The Supplier shall indemnify the Customer up to the fees paid under this agreement and subject to the liability cap.", "indemnity")],
      "missing-liability-cap": [makeClause("C2", "Liability cap", "The aggregate liability of either party shall not exceed $5,000,000.", "liability_cap")],
      "non-compete-excessive-duration": [makeClause("C3", "Non-compete", "The Consultant shall not compete for 12 months after termination.", "non_compete")],
      "auto-renewal-short-notice": [makeClause("C4", "Auto-renewal", "This agreement auto-renews on 30 days' prior written notice.", "auto_renewal")],
      "arbitration-outside-india": [makeClause("C5", "Arbitration", "Any dispute will be settled by arbitration seated in India.", "arbitration")],
      "unilateral-amendment-rights": [makeClause("C6", "Amendments", "This agreement may be amended only by a written instrument signed by both parties.", "other")],
      "asymmetric-termination-rights": [makeClause("C7", "Termination", "Either party may terminate on 30 days' notice for convenience.", "termination")],
      "payment-over-60-days": [makeClause("C8", "Payment terms", "Invoices are payable within 30 days of receipt.", "payment")],
      "ip-assignment-overreaching": [makeClause("C9", "Intellectual property", "Each party retains all pre-existing IP and only assigns services-created IP strictly for the work delivered under this agreement.", "ip_ownership")],
      "confidentiality-no-end-date": [makeClause("C10", "Confidentiality", "Confidential Information shall remain confidential for three years following termination.", "confidentiality")],
      "governing-law-jurisdiction-mismatch": [makeClause("C11", "Governing law", "This agreement is governed by the laws of India, and the courts of India shall have exclusive jurisdiction.", "jurisdiction")],
      "undefined-defined-term": [makeClause("C12", "Definitions", "The Term means the period beginning on execution and ending on completion.", "other")],
      "cross-reference-to-missing-clause": [
        makeClause("C1", "Intro", "The parties enter into this agreement.", "other"),
        makeClause("C2", "Term", "This agreement starts on the Effective Date.", "other"),
        makeClause("C4", "Section 3", "The parties agree to the obligations in Section 3.", "other"),
        makeClause("C3", "Reference", "The parties agree to the obligations in Clause 2 and Section 3.", "other"),
      ],
      "data-sharing-unnamed-third-parties": [makeClause("C14", "Data sharing", "The company will share personal data only with the specific named processor listed in Schedule 2 for the agreed processing purpose.", "data_privacy")],
    };

    const findings = evaluateRiskRules(fixtures[ruleId] ?? [makeClause("C1", ruleId, ruleId)], "both");
    assert.equal(findings.some((finding) => finding.ruleId === ruleId), false, `${ruleId} should not trigger on the negative fixture`);
  });
}

test("the same document produces different profiles for partyA and partyB", () => {
  const clauses: RiskClause[] = [
    makeClause("C1", "Termination", "Client may terminate for convenience on 30 days' notice. Provider may not terminate for convenience.", "termination"),
    makeClause("C2", "Indemnity", "Provider shall indemnify Client without cap for all losses.", "indemnity"),
    makeClause("C3", "Non-compete", "Consultant shall not compete for 36 months after termination.", "non_compete"),
  ];

  const partyA = evaluateDocumentRisk(clauses, "partyA");
  const partyB = evaluateDocumentRisk(clauses, "partyB");

  assert.notEqual(partyA.findings.length, partyB.findings.length);
  assert.ok(partyA.riskScore >= partyB.riskScore);
  assert.ok(partyA.findings.some((finding) => finding.ruleId === "asymmetric-termination-rights"));
  assert.ok(partyB.findings.some((finding) => finding.ruleId === "uncapped-indemnity"));
});
