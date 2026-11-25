import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { sessionHeaders } from "./csrfTestUtils";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { default: app } = await import("../app");

test("the document map evicts the least recently used user document and protects the recently viewed one", async () => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const auth = await sessionHeaders(baseUrl);
    const createdIds: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      const response = await fetch(`${baseUrl}/api/documents`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
        body: JSON.stringify({ name: `LRU document ${index}`, fileType: "txt", sizeBytes: 64 }),
      });
      assert.equal(response.status, 201);
      createdIds.push(((await response.json()) as { id: string }).id);
    }

    const leastRecentlyUsedId = createdIds[1];
    const recentlyUsedId = createdIds[0];
    assert.ok(leastRecentlyUsedId && recentlyUsedId);
    const touchResponse = await fetch(`${baseUrl}/api/documents/${recentlyUsedId}`, { headers: { cookie: auth.cookie } });
    assert.equal(touchResponse.status, 200);

    // Create one more document to trigger eviction after the first was refreshed.
    const triggerResponse = await fetch(`${baseUrl}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: JSON.stringify({ name: "LRU trigger", fileType: "txt", sizeBytes: 64 }),
    });
    assert.equal(triggerResponse.status, 201);

    const recentResponse = await fetch(`${baseUrl}/api/documents/${recentlyUsedId}`, { headers: { cookie: auth.cookie } });
    const evictedResponse = await fetch(`${baseUrl}/api/documents/${leastRecentlyUsedId}`, { headers: { cookie: auth.cookie } });
    assert.equal(recentResponse.status, 200);
    assert.equal(evictedResponse.status, 404);

    const listResponse = await fetch(`${baseUrl}/api/documents`, { headers: { cookie: auth.cookie } });
    const listed = (await listResponse.json()) as Array<{ id: string }>;
    assert.equal(listed.filter(({ id }) => id !== "doc-001" && id !== "doc-002").length, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});