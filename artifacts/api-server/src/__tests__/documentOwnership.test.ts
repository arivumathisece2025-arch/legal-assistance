import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createSession, serializeSession } from "../middlewares/session";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MOCK_LLM = "1";
const { default: app } = await import("../app");

function identity(userId: string) {
  const session = createSession(userId);
  return {
    cookie: `cc_session=${serializeSession(session)}`,
    csrfToken: session.csrfToken,
  };
}

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

async function upload(baseUrl: string, owner: ReturnType<typeof identity>): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob(["1. Termination. Either party may terminate on 30 days notice."], { type: "text/plain" }), "contract.txt");
  const response = await fetch(`${baseUrl}/api/documents/upload`, {
    method: "POST",
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
    body: form,
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

test("documents are isolated by owner and data deletion only removes the caller's documents", async () => {
  await withServer(async (baseUrl) => {
    const userA = identity("user-a");
    const userB = identity("user-b");
    const userADoc = await upload(baseUrl, userA);
    const userBDoc = await upload(baseUrl, userB);

    const listResponse = await fetch(`${baseUrl}/api/documents`, { headers: { cookie: userA.cookie } });
    const listedDocuments = (await listResponse.json()) as Array<{ id: string }>;
    assert.ok(listedDocuments.some((document) => document.id === userADoc));
    assert.ok(listedDocuments.some((document) => document.id === "doc-001"));
    assert.ok(!listedDocuments.some((document) => document.id === userBDoc));

    const unreadable = await fetch(`${baseUrl}/api/documents/${userBDoc}`, { headers: { cookie: userA.cookie } });
    assert.equal(unreadable.status, 404);

    const unaskable = await fetch(`${baseUrl}/api/documents/${userBDoc}/ask`, {
      method: "POST",
      headers: { cookie: userA.cookie, "x-csrf-token": userA.csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ documentId: userBDoc, question: "What does this say?", perspective: "party_a" }),
    });
    assert.equal(unaskable.status, 404);

    const unaskableByQuestionRoute = await fetch(`${baseUrl}/api/questions`, {
      method: "POST",
      headers: { cookie: userA.cookie, "x-csrf-token": userA.csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ documentId: userBDoc, question: "What does this say?", perspective: "party_a" }),
    });
    assert.equal(unaskableByQuestionRoute.status, 404);

    const uncomparable = await fetch(`${baseUrl}/api/documents/${userADoc}/compare`, {
      method: "POST",
      headers: { cookie: userA.cookie, "x-csrf-token": userA.csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ against: userBDoc }),
    });
    assert.equal(uncomparable.status, 404);

    const undeletable = await fetch(`${baseUrl}/api/documents/${userBDoc}`, {
      method: "DELETE",
      headers: { cookie: userA.cookie, "x-csrf-token": userA.csrfToken },
    });
    assert.equal(undeletable.status, 404);
    assert.equal((await fetch(`${baseUrl}/api/documents/${userBDoc}`, { headers: { cookie: userB.cookie } })).status, 200);

    const deletion = await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { cookie: userA.cookie, "x-csrf-token": userA.csrfToken },
    });
    assert.equal(deletion.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/documents/${userADoc}`, { headers: { cookie: userA.cookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/documents/${userBDoc}`, { headers: { cookie: userB.cookie } })).status, 200);
  });
});

test("uploads created within one millisecond receive distinct ids", async () => {
  const originalNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    await withServer(async (baseUrl) => {
      const owner = identity("same-millisecond-user");
      const first = await upload(baseUrl, owner);
      const second = await upload(baseUrl, owner);
      assert.notEqual(first, second);
      assert.match(first, /^doc-[0-9a-f-]{36}$/);
      assert.match(second, /^doc-[0-9a-f-]{36}$/);
    });
  } finally {
    Date.now = originalNow;
  }
});