import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  alignClauses,
  clauseTypeMatch,
  headingSimilarity,
  jaccardSimilarity,
  jaccardTokens,
  numericTokensDiffer,
  resolveClauseType,
  tokenSet,
  type AlignableClause,
} from "../align";
import { clearCache, getCacheValue } from "../cache";
import {
  analyzeMaterialChange,
  buildComparisonRows,
  compareVersions,
  diffRiskFindings,
  materialChangeCacheKey,
  smartModelLabel,
  type ChangeLabel,
  type VersionDocument,
} from "../versionDiff";
import { evaluateDocumentRisk, evaluateRiskRules, type RiskClause } from "../rules/packV1";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadVersion(fileName: string): VersionDocument {
  return JSON.parse(readFileSync(path.join(fixtureDir, fileName), "utf8")) as VersionDocument;
}

const baseVersion = loadVersion("contract-v1.json");
const revisedVersion = loadVersion("contract-v2.json");

function asRiskClauses(clauses: AlignableClause[]): RiskClause[] {
  return clauses.map((clause) => ({
    id: clause.id,
    ordinal: clause.ordinal ?? clause.id,
    heading: clause.heading,
    text: clause.text,
    page: 1,
    charStart: 0,
    charEnd: clause.text.length,
    type: resolveClauseType(clause),
  }));
}

function stubProvider(responder?: (user: string) => unknown) {
  const calls: string[] = [];
  const provider = {
    async completeJson<T>(_system: string, user: string, schema: { parse: (value: unknown) => T }): Promise<T> {
      calls.push(user);
      const payload = responder
        ? responder(user)
        : {
            materiallyChanged: true,
            summary: "The revised wording moves risk to the other side.",
            favors: "partyB",
            rationale: "The base version capped the exposure and the revision does not.",
          };
      return schema.parse(payload) as T;
    },
  };

  return { provider: provider as any, calls };
}

test("aligns two fixture contract versions into pairs, added clauses and removed clauses", () => {
  const alignment = alignClauses(baseVersion.clauses, revisedVersion.clauses);

  assert.deepEqual(
    alignment.pairs.map((pair) => pair.key),
    ["C1~C1", "C3~C3", "C4~C4", "C5~C5", "C6~C6"],
  );
  assert.deepEqual(alignment.added.map((clause) => clause.id), ["C7", "C8"]);
  assert.deepEqual(alignment.removed.map((clause) => clause.id), ["C2"]);
  assert.equal(alignment.scoreMatrix.length, baseVersion.clauses.length);
  assert.equal(alignment.scoreMatrix[0]?.length, revisedVersion.clauses.length);
});

test("flags a wording change and a number-only change as changed pairs", () => {
  const alignment = alignClauses(baseVersion.clauses, revisedVersion.clauses);
  const payment = alignment.pairs.find((pair) => pair.key === "C1~C1");
  const indemnity = alignment.pairs.find((pair) => pair.key === "C3~C3");
  const confidentiality = alignment.pairs.find((pair) => pair.key === "C4~C4");

  assert.ok(payment && indemnity && confidentiality);
  assert.equal(payment.numericChange, true);
  assert.equal(payment.changed, true);
  assert.ok(payment.similarity >= 0.9, "30 days and 90 days still read as the same clause");
  assert.equal(indemnity.numericChange, false);
  assert.equal(indemnity.changed, true);
  assert.ok(indemnity.similarity < 0.9);
  assert.equal(confidentiality.changed, false);
  assert.equal(confidentiality.similarity, 1);
  assert.equal(confidentiality.breakdown.headingSimilarity, 1);
  assert.equal(confidentiality.breakdown.clauseTypeMatch, 1);
});

test("scores heading similarity, clause-type match and Jaccard token similarity", () => {
  assert.equal(headingSimilarity("Governing Law", "governing law"), 1);
  assert.equal(headingSimilarity("Payment terms", "Limitation of liability"), 0);
  assert.equal(headingSimilarity("Indemnity", "Indemnification"), 0);
  assert.equal(headingSimilarity("Payment", "Payment terms"), 0.85);

  assert.equal(jaccardSimilarity("", ""), 1);
  assert.equal(jaccardSimilarity("terminate", "invoice"), 0);
  assert.equal(
    jaccardSimilarity("Client shall pay each invoice within 30 days of receipt", "Client shall pay each invoice within 90 days of receipt"),
    0.778,
  );
  assert.equal(jaccardSimilarity("Client shall pay each invoice within 90 days", "Client shall pay each invoice within 90 days"), 1);
  assert.equal(jaccardTokens(tokenSet("the of and to"), new Set()), 1);

  assert.equal(clauseTypeMatch("indemnity", "indemnity"), 1);
  assert.equal(clauseTypeMatch("indemnity", "payment"), 0);
  assert.equal(clauseTypeMatch("other", "payment"), 0.25);
  assert.equal(numericTokensDiffer("30 days", "90 days"), true);
  assert.equal(numericTokensDiffer("thirty days", "thirty days"), false);

  assert.equal(resolveClauseType({ id: "C9", heading: "Data processing", text: "shared with partners" }), "data_privacy");
  assert.equal(resolveClauseType({ id: "C9", heading: "Unlabelled section", text: "quiet text" }), "other");
  assert.equal(resolveClauseType({ id: "C9", heading: "Payment terms", text: "90 days", type: "payment" }), "payment");
});

test("greedy assignment never reuses a clause and leaves weak candidates unmatched", () => {
  const before: AlignableClause[] = [
    { id: "A1", heading: "Confidentiality", text: "Each party shall protect confidential information." },
    { id: "A2", heading: "Confidentiality", text: "Each party shall protect confidential information." },
    { id: "A3", heading: "Notices", text: "Notices must be delivered in writing." },
  ];
  const after: AlignableClause[] = [
    { id: "B1", heading: "Confidentiality", text: "Each party shall protect confidential information." },
  ];

  const alignment = alignClauses(before, after);
  assert.equal(alignment.pairs.length, 1);
  assert.equal(alignment.pairs[0]?.before.id, "A1");
  assert.equal(alignment.pairs[0]?.after.id, "B1");
  assert.deepEqual(alignment.removed.map((clause) => clause.id), ["A2", "A3"]);
  assert.deepEqual(alignment.added, []);

  const strict = alignClauses(before, after, { minMatchScore: 1.01 });
  assert.deepEqual(strict.pairs, []);
  assert.deepEqual(strict.removed.map((clause) => clause.id), ["A1", "A2", "A3"]);
  assert.deepEqual(strict.added.map((clause) => clause.id), ["B1"]);
});

test("diffs packV1 findings instead of only the raw text", () => {
  const beforeFindings = evaluateRiskRules(asRiskClauses([baseVersion.clauses[1]]), "both");
  const afterFindings = evaluateRiskRules(asRiskClauses([revisedVersion.clauses[1]]), "both");

  assert.deepEqual(beforeFindings.map((finding) => finding.ruleId), ["missing-liability-cap"]);
  assert.deepEqual(afterFindings.map((finding) => finding.ruleId), ["uncapped-indemnity"]);

  const changes = diffRiskFindings(beforeFindings, afterFindings, "partyB");
  const resolved = changes.find((change) => change.ruleId === "missing-liability-cap");
  const introduced = changes.find((change) => change.ruleId === "uncapped-indemnity");

  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.label, "Removed");
  assert.match(resolved?.message ?? "", /removed the high-risk finding: Missing or low liability cap/);
  assert.equal(introduced?.status, "introduced");
  assert.equal(introduced?.label, "Added");
  assert.equal(introduced?.concerns, "partyB");
  assert.equal(introduced?.favorsOtherParty, true);
  assert.match(introduced?.message ?? "", /introduced a high-risk finding: Uncapped indemnity/);
});

test("re-runs the rule engine on both versions and reports what the new version introduced", async () => {
  const comparison = await compareVersions(baseVersion, revisedVersion, {
    perspective: "partyB",
    analyzeMaterialChanges: false,
  });

  const introduced = comparison.rows
    .flatMap((row) => row.findingChanges)
    .filter((change) => change.status === "introduced")
    .map((change) => change.ruleId)
    .sort();
  const resolved = comparison.rows
    .flatMap((row) => row.findingChanges)
    .filter((change) => change.status === "resolved")
    .map((change) => change.ruleId);

  assert.deepEqual(introduced, [
    "data-sharing-unnamed-third-parties",
    "non-compete-excessive-duration",
    "payment-over-60-days",
    "uncapped-indemnity",
  ]);
  assert.deepEqual(resolved, ["missing-liability-cap"]);
  assert.equal(comparison.summary.introducedRiskCount, 4);
  assert.equal(comparison.summary.resolvedRiskCount, 1);
  assert.equal(comparison.summary.changedCount, 2);
  assert.equal(comparison.summary.addedCount, 2);
  assert.equal(comparison.summary.removedCount, 1);
  assert.equal(comparison.summary.unchangedCount, 3);

  const indemnityRow = comparison.rows.find((row) => row.after?.id === "C3");
  const message = indemnityRow?.findingChanges.map((change) => change.message).join(" ") ?? "";
  assert.match(message, /introduced a high-risk finding: Uncapped indemnity/);
  assert.ok(indemnityRow?.labels.includes("Changed"));
  assert.ok(indemnityRow?.labels.includes("Favors other party"));

  const findingsForRemovedClause = comparison.rows.find((row) => row.kind === "removed");
  assert.equal(findingsForRemovedClause?.before?.id, "C2");
  assert.match(findingsForRemovedClause?.findingChanges[0]?.message ?? "", /removed the high-risk finding/);
});


test("orders comparison rows in document order with removed clauses left in place", async () => {
  const comparison = await compareVersions(baseVersion, revisedVersion, { analyzeMaterialChanges: false });

  assert.deepEqual(
    comparison.rows.map((row) => row.kind),
    ["changed", "removed", "changed", "unchanged", "unchanged", "unchanged", "added", "added"],
  );
  assert.deepEqual(
    comparison.rows.map((row) => row.key),
    ["C1~C1", "removed~C2", "C3~C3", "C4~C4", "C5~C5", "C6~C6", "added~C7", "added~C8"],
  );
  assert.equal(comparison.base.name, "Northwind Services Agreement (v1)");
  assert.equal(comparison.revised.name, "Northwind Services Agreement (v2)");
  assert.equal(comparison.threshold, 0.9);
});

test("every change carries a text label, so direction is never colour alone", async () => {
  const allowed: ChangeLabel[] = ["Added", "Removed", "Changed", "Favors other party"];
  const comparison = await compareVersions(baseVersion, revisedVersion, {
    perspective: "partyB",
    analyzeMaterialChanges: false,
  });

  for (const row of comparison.rows) {
    if (row.kind === "unchanged") {
      assert.deepEqual(row.labels, [], `${row.key} should not be labelled as a change`);
      continue;
    }
    assert.ok(row.labels.length > 0, `${row.key} must carry a text label`);
    for (const label of row.labels) {
      assert.ok(allowed.includes(label), `${label} is not part of the change vocabulary`);
    }
  }

  const kindLabels: Record<string, ChangeLabel> = { changed: "Changed", added: "Added", removed: "Removed" };
  for (const row of comparison.rows) {
    const expected = kindLabels[row.kind];
    if (expected) assert.ok(row.labels.includes(expected), `${row.key} should be labelled ${expected}`);
  }

  assert.deepEqual(comparison.rows.find((row) => row.after?.id === "C7")?.labels, ["Added", "Favors other party"]);
  assert.deepEqual(comparison.rows.find((row) => row.after?.id === "C8")?.labels, ["Added"]);
});

test("favours other party flips with the reader's perspective", async () => {
  const asPartyA = await compareVersions(baseVersion, revisedVersion, {
    perspective: "partyA",
    analyzeMaterialChanges: false,
  });
  const asPartyB = await compareVersions(baseVersion, revisedVersion, {
    perspective: "partyB",
    analyzeMaterialChanges: false,
  });

  assert.deepEqual(asPartyA.rows.find((row) => row.after?.id === "C7")?.labels, ["Added"]);
  assert.deepEqual(asPartyA.rows.find((row) => row.after?.id === "C8")?.labels, ["Added", "Favors other party"]);
  assert.deepEqual(asPartyB.rows.find((row) => row.after?.id === "C7")?.labels, ["Added", "Favors other party"]);
  assert.deepEqual(asPartyB.rows.find((row) => row.after?.id === "C8")?.labels, ["Added"]);
  assert.equal(asPartyA.summary.favorsOtherPartyCount >= 1, true);
  assert.equal(asPartyB.summary.favorsOtherPartyCount >= 1, true);
});


test("hashes the cache key from the combined pair text", () => {
  const pair = alignClauses(baseVersion.clauses, revisedVersion.clauses).pairs.find(
    (candidate) => candidate.key === "C1~C1",
  );
  assert.ok(pair);

  const key = materialChangeCacheKey(pair.before, pair.after);
  assert.equal(key.length, 64);
  assert.equal(key, materialChangeCacheKey(pair.before, pair.after));
  assert.notEqual(key, materialChangeCacheKey(pair.after, pair.before));
  assert.ok(smartModelLabel().length > 0);
});

test("sends only the changed pairs to the smart model and caches each pair by its hash", async () => {
  clearCache();
  const first = stubProvider((user) => ({
    materiallyChanged: user.includes("without cap") ? true : false,
    summary: "The revised wording moves risk to the other side.",
    favors: "partyA",
    rationale: "The revision removes the cap and extends payment.",
  }));

  const comparison = await compareVersions(baseVersion, revisedVersion, {
    provider: first.provider,
    perspective: "partyB",
  });

  assert.equal(first.calls.length, 2, "one call per changed pair, never one per clause");

  const paymentPrompt = first.calls.find((prompt) => prompt.includes("Payment terms"));
  const indemnityPrompt = first.calls.find((prompt) => prompt.includes("Indemnification"));
  assert.ok(paymentPrompt && indemnityPrompt);
  assert.match(paymentPrompt, /BASE VERSION:/);
  assert.match(paymentPrompt, /30 days of receipt/);
  assert.match(paymentPrompt, /90 days of receipt/);
  assert.doesNotMatch(paymentPrompt, /without cap and without limit/, "only the pair is sent");
  assert.doesNotMatch(indemnityPrompt, /invoice within 90 days/, "only the pair is sent");

  const changedRows = comparison.rows.filter((row) => row.kind === "changed");
  assert.equal(changedRows.length, 2);
  for (const row of changedRows) {
    assert.equal(row.materialChange?.available, true);
    assert.equal(row.materialChange?.fromCache, false);
    assert.equal(row.materialChange?.favors, "partyA");
    assert.ok(row.labels.includes("Favors other party"), "the model says the counterparty benefits");
  }

  const repeat = stubProvider();
  const secondRun = await compareVersions(baseVersion, revisedVersion, {
    provider: repeat.provider,
    perspective: "partyB",
  });

  assert.equal(repeat.calls.length, 0, "a cached pair hash never reaches Groq again");
  for (const row of secondRun.rows.filter((candidate) => candidate.kind === "changed")) {
    assert.equal(row.materialChange?.fromCache, true);
  }
  assert.ok(getCacheValue<unknown>(materialChangeCacheKey(
    baseVersion.clauses[0] as AlignableClause,
    revisedVersion.clauses[0] as AlignableClause,
  )));
});

test("compareVersions stays deterministic when no provider is available", async () => {
  clearCache();
  const comparison = await compareVersions(baseVersion, revisedVersion);

  assert.equal(comparison.rows.length, 8);
  assert.equal(comparison.rows.every((row) => row.materialChange === undefined), true);
  assert.equal(comparison.summary.introducedRiskCount, 4);
});

test("a provider failure is reported instead of breaking the comparison", async () => {
  clearCache();
  const provider = {
    async completeJson(): Promise<never> {
      throw new Error("GROQ_API_KEY is not configured.");
    },
  };

  const comparison = await compareVersions(baseVersion, revisedVersion, {
    provider: provider as any,
    perspective: "partyB",
  });
  const changedRows = comparison.rows.filter((row) => row.kind === "changed");

  assert.equal(changedRows.length, 2);
  for (const row of changedRows) {
    assert.equal(row.materialChange?.available, false);
    assert.equal(row.materialChange?.favors, "neither");
    assert.equal(row.materialChange?.rationale, "GROQ_API_KEY is not configured.");
    assert.ok(row.labels.includes("Changed"), "the wording change is still labelled");
  }
});


test("a rule finding delta promotes a long clause to changed even when tokens barely move", async () => {
  const baseText =
    "Provider shall indemnify, defend, and hold harmless Client from any and all claims, losses, damages, liabilities, and expenses arising from the Services.";
  const revisedText = `${baseText.slice(0, -1)}, without cap and without limit.`;

  const base: VersionDocument = {
    id: "northwind-v1",
    name: "Northwind v1",
    clauses: [{ id: "C7", ordinal: "7", heading: "Indemnification", type: "indemnity", text: baseText }],
  };
  const revised: VersionDocument = {
    id: "northwind-v2",
    name: "Northwind v2",
    clauses: [{ id: "R7", ordinal: "7", heading: "Indemnification", type: "indemnity", text: revisedText }],
  };

  const alignment = alignClauses(base.clauses, revised.clauses);
  const pair = alignment.pairs[0];
  assert.ok(pair);
  assert.ok(pair.similarity >= 0.9, "a long clause absorbs a two-word edit in its token overlap");
  assert.equal(pair.changed, false, "text similarity alone would miss this edit");

  const comparison = await compareVersions(base, revised, { perspective: "partyB", analyzeMaterialChanges: false });
  const row = comparison.rows[0];

  assert.equal(row?.kind, "changed");
  assert.ok(row?.labels.includes("Changed"));
  assert.ok(row?.labels.includes("Favors other party"));
  assert.match(
    row?.findingChanges.map((change) => change.message).join(" ") ?? "",
    /introduced a high-risk finding: Uncapped indemnity/,
  );
  assert.equal(comparison.summary.introducedRiskCount, 1);
  assert.equal(comparison.summary.changedCount, 1);
});


