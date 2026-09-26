import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

process.env.APP_ENCRYPTION_KEY = "integration-test-key";
const { default: app } = await import("../app");

type ComparisonResponse = {
  base: { id: string; name: string };
  revised: { id: string; name: string };
  threshold: number;
  perspective: string;
  rows: Array<{
    key: string;
    kind: "unchanged" | "changed" | "added" | "removed";
    similarity: number;
    labels: string[];
    before?: { id: string; heading: string };
    after?: { id: string; heading: string };
    materialChange?: { available: boolean; summary: string };
    findingChanges: Array<{ status: string; ruleId: string; message: string; favorsOtherParty: boolean }>;
  }>;
  summary: {
    changedCount: number;
    addedCount: number;
    removedCount: number;
    introducedRiskCount: number;
    resolvedRiskCount: number;
  };
};

async function withServer<T>(callback: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function compare(baseUrl: string, revisedId: string, against: string, perspective = "party_b") {
  return fetch(`${baseUrl}/api/documents/${revisedId}/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ against, perspective }),
  });
}

test("compare endpoint aligns versions and reports what the revision introduced", async () => {
  await withServer(async (baseUrl) => {
    const response = await compare(baseUrl, "doc-002", "doc-001");
    const body = (await response.json()) as ComparisonResponse;

    assert.equal(response.status, 200);
    assert.equal(body.base.id, "doc-001");
    assert.equal(body.revised.id, "doc-002");
    assert.equal(body.perspective, "partyB");
    assert.equal(body.threshold, 0.9);

    assert.deepEqual(
      body.rows.map((row) => row.kind),
      ["changed", "added", "changed", "removed", "unchanged", "unchanged"],
    );
    assert.equal(body.summary.addedCount, 1);
    assert.equal(body.summary.removedCount, 1);
    assert.equal(body.summary.changedCount, 2);
    assert.equal(body.summary.introducedRiskCount, 3);
    assert.equal(body.summary.resolvedRiskCount, 0);

    const removed = body.rows.find((row) => row.kind === "removed");
    assert.equal(removed?.before?.heading, "Confidentiality");
    assert.deepEqual(removed?.labels, ["Removed"]);

    const indemnity = body.rows.find((row) => row.after?.heading === "Indemnification");
    assert.ok(indemnity?.labels.includes("Changed"));
    assert.ok(indemnity?.labels.includes("Favors other party"));
    assert.match(
      indemnity?.findingChanges.map((change) => change.message).join(" ") ?? "",
      /introduced a high-risk finding: Uncapped indemnity/,
    );

    const dataProcessing = body.rows.find((row) => row.after?.heading === "Data processing");
    assert.ok(dataProcessing?.labels.includes("Added"));

    for (const row of body.rows) {
      if (row.kind === "unchanged") continue;
      assert.ok(row.labels.length > 0, `${row.key} must carry a text label`);
    }
  });
});

test("compare endpoint rejects comparing a version with itself", async () => {
  await withServer(async (baseUrl) => {
    const response = await compare(baseUrl, "doc-001", "doc-001");
    const body = (await response.json()) as { error: string };

    assert.equal(response.status, 400);
    assert.match(body.error, /two different versions/);
  });
});

test("compare endpoint reports an unknown version instead of throwing", async () => {
  await withServer(async (baseUrl) => {
    const missingAgainst = await compare(baseUrl, "doc-001", "doc-999");
    assert.equal(missingAgainst.status, 404);

    const missingRevised = await compare(baseUrl, "doc-999", "doc-001");
    assert.equal(missingRevised.status, 404);
  });
});
