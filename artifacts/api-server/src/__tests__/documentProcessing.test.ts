import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { sessionHeaders } from "./csrfTestUtils";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GROQ_API_KEY = "test-key";
delete process.env.MOCK_LLM;
const { default: app } = await import("../app");
const { clearCache, GroqProvider } = await import("@workspace/core");

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

test("uploads classify 60 clauses in three batches, cache repeated text, and simplify through the route", async () => {
  clearCache();
  const originalCompleteJson = GroqProvider.prototype.completeJson;
  let classificationCalls = 0;
  let simplifyCalls = 0;
  GroqProvider.prototype.completeJson = async function (
    _system: string,
    user: string,
    schema: { description?: string; parse(value: unknown): unknown },
  ) {
    if (schema.description === "clause-classification") {
      classificationCalls += 1;
      const batch = JSON.parse(user) as Array<{ id: string; text: string }>;
      return schema.parse({
        items: batch.map(({ id, text }) => ({ clauseId: id, type: "termination", severity: "medium", summary: text.slice(0, 100) })),
      }) as never;
    }
    if (schema.description === "clause-simplification") {
      simplifyCalls += 1;
      const clauses = Array.from(user.matchAll(/Clause ([^:]+): ([^\n]+)\n([\s\S]*?)(?=\n\nClause |\n\nReturn JSON|$)/g));
      return schema.parse({
        items: clauses.flatMap(([, clauseId, _heading, text]) => ["as-written", "plain", "simple"].map((level) => ({
          clauseId,
          level,
          text: level === "as-written" ? text.trim() : "The party may end the agreement after 30 days notice.",
        }))),
      }) as never;
    }
    throw new Error(`Unexpected schema ${schema.description ?? "unknown"}`);
  };

  try {
    await withServer(async (baseUrl) => {
      const auth = await sessionHeaders(baseUrl);
      const text = Array.from({ length: 60 }, (_, index) =>
        `${index + 1}. Termination. Either party may terminate the agreement with ${index + 1} days written notice.`,
      ).join("\n");

      async function upload() {
        const form = new FormData();
        form.append("file", new Blob([text], { type: "text/plain" }), "sixty-clauses.txt");
        return fetch(`${baseUrl}/api/documents/upload`, {
          method: "POST",
          headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
          body: form,
        });
      }

      const firstUpload = await upload();
      const firstDocument = await firstUpload.json() as { id: string; clauses: Array<{ id: string; type: string; severity: string; summary: string }> };
      assert.equal(firstUpload.status, 201);
      assert.equal(firstDocument.clauses.length, 60);
      assert.equal(firstDocument.clauses[0]?.type, "termination");
      assert.equal(firstDocument.clauses[0]?.severity, "medium");
      assert.ok(firstDocument.clauses[0]?.summary);
      assert.equal(classificationCalls, 3);

      const secondUpload = await upload();
      assert.equal(secondUpload.status, 201);
      assert.equal(classificationCalls, 3, "identical clause batches should be served from the classification cache");

      const analyzeResponse = await fetch(`${baseUrl}/api/documents/${firstDocument.id}`, {
        method: "POST",
        headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      });
      assert.equal(analyzeResponse.status, 202);
      const getAnalyzed = await fetch(`${baseUrl}/api/documents/${firstDocument.id}`, { headers: { cookie: auth.cookie } });
      const analyzed = await getAnalyzed.json() as { clauses: Array<{ text: string }> };
      assert.equal(getAnalyzed.status, 200);
      assert.match(analyzed.clauses[0]?.text ?? "", /Either party may terminate/);
      assert.doesNotMatch(JSON.stringify(analyzed.clauses), /Northstar/);

      const simplifyBody = { language: "en", clauseIds: [firstDocument.clauses[0]!.id] };
      const simplifyUrl = `${baseUrl}/api/documents/${firstDocument.id}/simplify`;
      const simplifyHeaders = { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken };
      const firstSimplification = await fetch(simplifyUrl, { method: "POST", headers: simplifyHeaders, body: JSON.stringify(simplifyBody) });
      const simplified = await firstSimplification.json() as { items: Array<{ level: string; text: string }> };
      assert.equal(firstSimplification.status, 200);
      assert.equal(simplified.items.length, 3);
      assert.ok(simplified.items.some((item) => item.level === "plain" && /end the agreement/.test(item.text)));

      const cachedSimplification = await fetch(simplifyUrl, { method: "POST", headers: simplifyHeaders, body: JSON.stringify(simplifyBody) });
      assert.equal(cachedSimplification.status, 200);
      assert.equal(simplifyCalls, 1);
    });
  } finally {
    GroqProvider.prototype.completeJson = originalCompleteJson;
  }
});

test("analyze returns conflict for an empty workspace instead of copying seed clauses", async () => {
  await withServer(async (baseUrl) => {
    const auth = await sessionHeaders(baseUrl);
    const createResponse = await fetch(`${baseUrl}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ name: "Empty workspace", fileType: "txt", sizeBytes: 64 }),
    });
    const created = await createResponse.json() as { id: string };
    const analyzeResponse = await fetch(`${baseUrl}/api/documents/${created.id}`, {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
    });

    assert.equal(analyzeResponse.status, 409);
    assert.equal((await analyzeResponse.json() as { code: string }).code, "DOCUMENT_TEXT_REQUIRED");
  });
});