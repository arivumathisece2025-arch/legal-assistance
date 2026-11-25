import assert from "node:assert/strict";
import test from "node:test";
import { extractObligations, resolveRelativeDate } from "../obligations";
import { buildIcsCalendar, buildLawyerPrepBrief, buildObligationChecklist } from "../exports";
import { evaluateDocumentRisk } from "../rules/packV1";

const sampleClauses = [
  {
    id: "C1",
    ordinal: "1",
    heading: "Payment",
    text: "The supplier shall pay the fees within 30 days of termination.",
    page: 1,
    charStart: 0,
    charEnd: 80,
  },
  {
    id: "C2",
    ordinal: "2",
    heading: "Confidentiality",
    text: "The receiving party shall keep the information confidential for a period of 5 years after completion.",
    page: 1,
    charStart: 81,
    charEnd: 180,
  },
  {
    id: "C3",
    ordinal: "3",
    heading: "Termination",
    text: "Either party may terminate for convenience on 15 days' notice.",
    page: 1,
    charStart: 181,
    charEnd: 260,
  },
];

test("resolveRelativeDate resolves 30-day deadlines against the supplied effective date", () => {
  const resolved = resolveRelativeDate("within 30 days of termination", new Date("2025-01-01"));
  assert.equal(resolved.dueDate, "2025-01-31");
});

test("extractObligations makes one provider call and resolves dates in TypeScript", async () => {
  let callCount = 0;
  const provider = {
    async completeJson<T>(_system: string, _user: string, schema: { parse: (value: unknown) => T }): Promise<T> {
      callCount += 1;
      return schema.parse({
        obligations: [
          {
            party: "partyA",
            who: "Supplier",
            what: "Pay fees",
            due: "within 30 days of termination",
            sourceClauseId: "C1",
          },
        ],
      }) as T;
    },
  } as any;

  const result = await extractObligations(sampleClauses, provider, new Date("2025-01-01"));
  assert.equal(callCount, 1);
  assert.equal(result[0]?.sourceClauseId, "C1");
  assert.equal(result[0]?.dueDate, "2025-01-31");
});

test("buildObligationChecklist groups obligations by party and deadline", () => {
  const checklist = buildObligationChecklist([
    { party: "partyA", who: "Supplier", what: "Pay fees", due: "within 30 days", dueDate: "2025-01-31", sourceClauseId: "C1" },
    { party: "partyB", who: "Customer", what: "Return materials", due: "within 10 days", dueDate: "2025-01-11", sourceClauseId: "C5" },
  ]);

  assert.deepEqual(checklist.partyA.map((item) => item.sourceClauseId), ["C1"]);
  assert.deepEqual(checklist.partyB.map((item) => item.sourceClauseId), ["C5"]);
});

test("buildIcsCalendar emits valid VEVENT blocks for obligations", () => {
  const ics = buildIcsCalendar([
    { party: "partyA", who: "Supplier", what: "Pay fees", due: "within 30 days", dueDate: "2025-01-31", sourceClauseId: "C1" },
  ]);

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:20250131/);
  assert.match(ics, /DESCRIPTION:.*Clause: C1/);
});

test("buildLawyerPrepBrief uses askYourLawyer questions from packV1 risk findings", () => {
  const riskProfile = evaluateDocumentRisk(
    [
      {
        id: "C4",
        ordinal: "4",
        heading: "Indemnity",
        text: "The supplier shall indemnify the customer without cap.",
        page: 1,
        charStart: 0,
        charEnd: 80,
        type: "indemnity",
      },
      {
        id: "C5",
        ordinal: "5",
        heading: "Confidentiality",
        text: "The receiving party shall keep information confidential forever.",
        page: 1,
        charStart: 81,
        charEnd: 180,
        type: "confidentiality",
      },
    ],
    "partyB",
  );

  const brief = buildLawyerPrepBrief({
    documentName: "Vendor Agreement",
    parties: ["Party A", "Party B"],
    findings: riskProfile,
    obligations: [
      { party: "partyA", who: "Supplier", what: "Pay fees", due: "within 30 days", dueDate: "2025-01-31", sourceClauseId: "C1" },
    ],
    unresolvedInconsistencies: ["Check the indemnity cap against the service value."],
  });

  assert.match(brief, /Lawyer Prep Brief/);
  assert.match(brief, /Should the indemnity be capped/);
  assert.match(brief, /without cap/);
  assert.match(brief, /Checklist by party and deadline/);
});
