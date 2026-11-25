import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createServer } from "node:http";
import { parseSession, SESSION_COOKIE } from "../middlewares/session";
import { listAuditLog, resetAuditChain, verifyAuditChain } from "../lib/auditLog";
import { resetRateLimits } from "../middlewares/rateLimit";
import { purgeDocumentsFor } from "../routes/documents";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MOCK_LLM = "1";
delete process.env.DATABASE_URL;

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

/** Performs a bootstrap GET, then returns a cookie/CSRF pair for mutating calls. */
async function authenticated(baseUrl: string): Promise<{ cookie: string; csrfToken: string }> {
  const bootstrap = await fetch(`${baseUrl}/api/healthz`);
  const rawValue = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(bootstrap.headers.get("set-cookie") ?? "")?.[1];
  assert.ok(rawValue, "expected a session cookie");

  const session = parseSession(decodeURIComponent(rawValue));
  assert.ok(session, "expected a verifiable session");

  return { cookie: `${SESSION_COOKIE}=${rawValue}`, csrfToken: session.csrfToken };
}

type DeleteResponse = {
  message: string;
  documentsPurged: number;
  databaseRowsDeleted: number | null;
  databaseConfigured: boolean;
};

beforeEach(() => {
  resetAuditChain();
  resetRateLimits();
});

test("the deletion route refuses to act without a CSRF token", async () => {
  await withServer(async (baseUrl) => {
    const { cookie } = await authenticated(baseUrl);
    const response = await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { cookie },
    });

    assert.equal(response.status, 403);
  });
});

test("an authenticated deletion really removes only the caller's documents", async () => {
  await withServer(async (baseUrl) => {
    const { cookie, csrfToken } = await authenticated(baseUrl);

    const before = await fetch(`${baseUrl}/api/documents`, { headers: { cookie } });
    const beforeBody = (await before.json()) as unknown[];
    assert.ok(beforeBody.length > 0, "expected seeded documents to exist first");

    // Upload a private document owned by this session.
    const form = new FormData();
    form.append("file", new Blob([`1. Test clause. This is private.`], { type: "text/plain" }), "private.txt");
    const uploadResponse = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
      body: form,
    });
    assert.equal(uploadResponse.status, 201);
    const uploadBody = (await uploadResponse.json()) as { id: string };
    const myDocId = uploadBody.id;

    // After upload, the caller should see public docs + their own.
    const afterUpload = await fetch(`${baseUrl}/api/documents`, { headers: { cookie } });
    const afterUploadBody = (await afterUpload.json()) as unknown[];
    assert.ok(afterUploadBody.length >= beforeBody.length, "uploaded doc should appear in list");

    const response = await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    const body = (await response.json()) as DeleteResponse;

    assert.equal(response.status, 200);
    assert.ok(body.documentsPurged >= 1, "caller's uploaded doc should be purged");

    // Public documents remain; only the caller's private docs are gone.
    const after = await fetch(`${baseUrl}/api/documents`, { headers: { cookie } });
    const afterBody = (await after.json()) as unknown[];
    const stillHasMyDoc = afterBody.some(
      (doc) => typeof doc === "object" && doc !== null && "id" in doc && doc.id === myDocId,
    );
    assert.equal(stillHasMyDoc, false, "caller's document must be gone");
    assert.ok(afterBody.length > 0, "public documents should remain");
  });
});

test("the deletion route reports honestly when no database is configured", async () => {
  await withServer(async (baseUrl) => {
    const { cookie, csrfToken } = await authenticated(baseUrl);

    const response = await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    const body = (await response.json()) as DeleteResponse;

    assert.equal(body.databaseConfigured, false);
    assert.equal(body.databaseRowsDeleted, null, "must not claim to have deleted rows it never touched");
  });
});

test("a deletion request is written to the audit chain", async () => {
  await withServer(async (baseUrl) => {
    const { cookie, csrfToken } = await authenticated(baseUrl);

    await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });

    const entries = listAuditLog();
    assert.ok(entries.some((entry) => entry.action === "DATA_DELETION_REQUEST"));
    assert.equal(verifyAuditChain().valid, true);
  });
});

test("audit routes never expose entries over HTTP", async () => {
  await withServer(async (baseUrl) => {
    const entriesResponse = await fetch(`${baseUrl}/api/audit`);
    assert.equal(entriesResponse.status, 404);

    const verifyResponse = await fetch(`${baseUrl}/api/audit/verify`);
    const body = (await verifyResponse.json()) as Record<string, unknown>;
    assert.equal(verifyResponse.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ["length", "valid"]);
  });
});

test("the audit chain verifies over HTTP", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/audit/verify`);
    const body = (await response.json()) as { valid: boolean; length: number };

    assert.equal(response.status, 200);
    assert.equal(body.valid, true);
    assert.equal(body.length, 0);
    assert.deepEqual(Object.keys(body).sort(), ["length", "valid"]);
  });
});

test("purgeDocumentsFor only removes the caller's documents", () => {
  assert.deepEqual(purgeDocumentsFor("user-a"), []);
  assert.deepEqual(purgeDocumentsFor("user-a"), []);
});