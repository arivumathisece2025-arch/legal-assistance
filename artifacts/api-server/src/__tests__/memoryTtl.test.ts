import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createSession, serializeSession } from "../middlewares/session";
import { getAccessibleDocument, sweepExpiredMemoryDocuments } from "../routes/documents";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MOCK_LLM = "1";
const { default: app } = await import("../app");

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

async function upload(baseUrl: string, userId: string): Promise<{ id: string; cookie: string; csrfToken: string }> {
  const session = createSession(userId);
  const cookie = `cc_session=${serializeSession(session)}`;
  const form = new FormData();
  form.append("file", new Blob(["1. Termination. Either party may terminate with notice."], { type: "text/plain" }), "contract.txt");
  const response = await fetch(`${baseUrl}/api/documents/upload`, {
    method: "POST",
    headers: { cookie, "x-csrf-token": session.csrfToken },
    body: form,
  });
  assert.equal(response.status, 201);
  return { id: ((await response.json()) as { id: string }).id, cookie, csrfToken: session.csrfToken };
}

test("an expired in-memory document is deleted and returned as not found", async () => {
  await withServer(async (baseUrl) => {
    const created = await upload(baseUrl, "ttl-expired-user");
    const document = getAccessibleDocument(created.id, "ttl-expired-user");
    assert.ok(document);
    document.expiresAt = new Date(Date.now() - 1).toISOString();

    const response = await fetch(`${baseUrl}/api/documents/${created.id}`, { headers: { cookie: created.cookie } });
    assert.equal(response.status, 404);
    assert.equal(getAccessibleDocument(created.id, "ttl-expired-user"), undefined);
  });
});

test("the in-memory TTL sweep removes expired records", async () => {
  await withServer(async (baseUrl) => {
    const created = await upload(baseUrl, "ttl-sweep-user");
    const document = getAccessibleDocument(created.id, "ttl-sweep-user");
    assert.ok(document);
    document.expiresAt = new Date(1_000).toISOString();

    assert.deepEqual(sweepExpiredMemoryDocuments(new Date(2_000)), [created.id]);
    assert.equal(getAccessibleDocument(created.id, "ttl-sweep-user"), undefined);
  });
});