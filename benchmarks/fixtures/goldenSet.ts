import type { ClauseType } from "../../lib/core/src/classify";

/**
 * One clause of a golden contract. `text` is the clause body; the heading is
 * the part before the first period and is what `segmentDocument` lifts out of
 * the numbered line.
 */
export type GoldenClause = {
  /** Heading as a human writes it, e.g. "Non-Compete". */
  heading: string;
  /** Body text that follows the heading on the same numbered line. */
  text: string;
  /** The type `resolveClauseType` is expected to infer from the heading. */
  expectedType: ClauseType;
};

export type GoldenQaPair = {
  question: string;
  /** Heading of the clause that should be cited in the answer. */
  expectedCitationHeading: string;
};

export type GoldenContract = {
  id: string;
  name: string;
  clauses: GoldenClause[];
  /**
   * Rule ids from `lib/core/src/rules/packV1.ts` that this document is expected
   * to trigger. These are real pack ids, not invented labels.
   */
  expectedRules: string[];
  qaPairs: GoldenQaPair[];
};

export const goldenSet: GoldenContract[] = [
  {
    id: "c01",
    name: "NDA with indefinite confidentiality",
    clauses: [
      {
        heading: "Confidentiality",
        text: "The receiving party shall protect all Confidential Information indefinitely.",
        expectedType: "confidentiality",
      },
      {
        heading: "Term",
        text: "This agreement remains in effect for one year from the Effective Date.",
        expectedType: "other",
      },
    ],
    expectedRules: ["confidentiality-no-end-date"],
    qaPairs: [
      { question: "How long does confidentiality last?", expectedCitationHeading: "Confidentiality" },
      { question: "How long is the term?", expectedCitationHeading: "Term" },
    ],
  },
  {
    id: "c02",
    name: "Employment with a three-year non-compete",
    clauses: [
      {
        heading: "Non-Compete",
        text: "For 3 years following termination, the employee shall not engage in a competing business.",
        expectedType: "non_compete",
      },
      {
        heading: "Termination",
        text: "Either party may terminate this agreement on 30 days written notice.",
        expectedType: "termination",
      },
    ],
    expectedRules: ["non-compete-excessive-duration"],
    qaPairs: [{ question: "How long is the non-compete?", expectedCitationHeading: "Non-Compete" }],
  },
  {
    id: "c03",
    name: "SaaS with an uncapped indemnity",
    clauses: [
      {
        heading: "Indemnification",
        text: "Provider shall indemnify Customer against all third-party claims without any cap.",
        expectedType: "indemnity",
      },
      {
        heading: "Limitation of Liability",
        text: "In no event shall Provider's aggregate liability exceed the fees paid in the preceding month.",
        expectedType: "liability_cap",
      },
    ],
    expectedRules: ["uncapped-indemnity"],
    qaPairs: [{ question: "Is the indemnity capped?", expectedCitationHeading: "Indemnification" }],
  },
  {
    id: "c04",
    name: "Freelance agreement with sweeping IP assignment",
    clauses: [
      {
        heading: "Assignment",
        text: "Freelancer assigns all intellectual property and all inventions to the Client.",
        expectedType: "ip_ownership",
      },
      {
        heading: "Payment",
        text: "The Client shall pay each invoice within 30 days of receipt.",
        expectedType: "payment",
      },
    ],
    expectedRules: ["ip-assignment-overreaching"],
    qaPairs: [{ question: "What happens to the inventions?", expectedCitationHeading: "Assignment" }],
  },
  {
    id: "c05",
    name: "Lease with mismatched law and forum",
    clauses: [
      {
        heading: "Governing Law",
        text: "This agreement is governed by the laws of Delaware, and all disputes shall be resolved in the courts of Texas.",
        expectedType: "jurisdiction",
      },
      {
        heading: "Term",
        text: "The lease shall remain in effect for a period of 5 years.",
        expectedType: "other",
      },
    ],
    expectedRules: ["governing-law-jurisdiction-mismatch"],
    qaPairs: [{ question: "Which courts hear disputes?", expectedCitationHeading: "Governing Law" }],
  },
  {
    id: "c06",
    name: "Vendor agreement arbitrated in London",
    clauses: [
      {
        heading: "Dispute Resolution",
        text: "All disputes shall be resolved by arbitration seated in London.",
        expectedType: "arbitration",
      },
      {
        heading: "Term",
        text: "This agreement is for 1 year.",
        expectedType: "other",
      },
    ],
    expectedRules: ["arbitration-outside-india"],
    qaPairs: [{ question: "Where is arbitration held?", expectedCitationHeading: "Dispute Resolution" }],
  },
  {
    id: "c07",
    name: "Partnership with asymmetric termination rights",
    clauses: [
      {
        heading: "Termination",
        text: "Partner A may terminate without cause at any time, while Partner B may only terminate for material breach.",
        expectedType: "termination",
      },
      {
        heading: "Confidentiality",
        text: "Confidential Information has no end date.",
        expectedType: "confidentiality",
      },
    ],
    expectedRules: ["asymmetric-termination-rights", "confidentiality-no-end-date"],
    qaPairs: [{ question: "Can Partner B terminate easily?", expectedCitationHeading: "Termination" }],
  },
  {
    id: "c08",
    name: "Loan with a 120-day repayment window",
    clauses: [
      {
        heading: "Repayment",
        text: "Borrower shall repay the principal within 120 days of invoice.",
        expectedType: "payment",
      },
      {
        heading: "Confidentiality",
        text: "All data shared under this agreement is confidential.",
        expectedType: "confidentiality",
      },
    ],
    expectedRules: ["payment-over-60-days"],
    qaPairs: [{ question: "What is the repayment window?", expectedCitationHeading: "Repayment" }],
  },
  {
    id: "c09",
    name: "Subscription with short-notice auto-renewal",
    clauses: [
      {
        heading: "Auto-Renewal",
        text: "The subscription renews automatically and continues for successive terms unless notice is given within 15 days.",
        expectedType: "auto_renewal",
      },
      {
        heading: "Term",
        text: "The initial term is 12 months.",
        expectedType: "other",
      },
    ],
    expectedRules: ["auto-renewal-short-notice"],
    qaPairs: [{ question: "How do I stop the renewal?", expectedCitationHeading: "Auto-Renewal" }],
  },
  {
    id: "c10",
    name: "Data processing sharing with unnamed parties",
    clauses: [
      {
        heading: "Data Sharing",
        text: "The Processor may share personal data with any third party or affiliate as it deems necessary.",
        expectedType: "data_privacy",
      },
      {
        heading: "Term",
        text: "This agreement is for 1 year.",
        expectedType: "other",
      },
    ],
    expectedRules: ["data-sharing-unnamed-third-parties"],
    qaPairs: [{ question: "Who receives the personal data?", expectedCitationHeading: "Data Sharing" }],
  },
  {
    id: "c11",
    name: "Services with a cross-reference to a missing clause",
    clauses: [
      {
        heading: "Service Levels",
        text: "Provider shall meet the service levels described in clause 9.",
        expectedType: "other",
      },
      {
        heading: "Term",
        text: "This agreement is for 1 year.",
        expectedType: "other",
      },
    ],
    expectedRules: ["cross-reference-to-missing-clause"],
    qaPairs: [{ question: "What are the service levels?", expectedCitationHeading: "Service Levels" }],
  },
  {
    id: "c12",
    name: "Agreement with unilateral amendment rights",
    clauses: [
      {
        heading: "Amendment",
        text: "Provider may amend this agreement at any time without notice to the Client.",
        expectedType: "other",
      },
      {
        heading: "Term",
        text: "This agreement is for 1 year.",
        expectedType: "other",
      },
    ],
    expectedRules: ["unilateral-amendment-rights"],
    qaPairs: [{ question: "Who can change the agreement?", expectedCitationHeading: "Amendment" }],
  },
  {
    id: "c13",
    name: "Engagement with a low liability cap",
    clauses: [
      {
        heading: "Limitation of Liability",
        text: "Provider's total liability shall not to exceed $50,000 in any twelve month period.",
        expectedType: "liability_cap",
      },
      {
        heading: "Term",
        text: "This agreement is for 1 year.",
        expectedType: "other",
      },
    ],
    expectedRules: ["missing-liability-cap"],
    qaPairs: [{ question: "What is the liability cap?", expectedCitationHeading: "Limitation of Liability" }],
  },
  {
    id: "c14",
    name: "Consulting agreement using an undefined capitalised term",
    clauses: [
      {
        heading: "Fees",
        text: "Client shall pay the Charges set out in SCHEDULE B within 30 days.",
        expectedType: "payment",
      },
      {
        heading: "Term",
        text: "This agreement is for 1 year.",
        expectedType: "other",
      },
    ],
    expectedRules: ["undefined-defined-term"],
    qaPairs: [{ question: "When are fees due?", expectedCitationHeading: "Fees" }],
  },
];

/** Renders a golden contract as the numbered plain text that `parsePlainText` ingests. */
export function renderContractText(contract: GoldenContract): string {
  return contract.clauses
    .map((clause, index) => `${index + 1}. ${clause.heading}. ${clause.text}`)
    .join("\n");
}
