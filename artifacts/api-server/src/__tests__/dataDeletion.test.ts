import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createServer } from "node:http";
import { parseSession, SESSION_COOKIE } from "../middlewares/session";
import { resetAuditChain, verifyAuditChain } from "../lib/auditLog";
import { resetRateLimits } from "../middlewares/rateLimit";
import { purgeAllDocuments } from "../routes/documents";

process.env.APP_ENCRYPTION_KEY = "data-deletion-test-key";
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

test("an authenticated deletion really removes the in-memory documents", async () => {
  await withServer(async (baseUrl) => {
    const { cookie, csrfToken } = await authenticated(baseUrl);

    const before = await fetch(`${baseUrl}/api/documents`);
    const beforeBody = (await before.json()) as unknown[];
    assert.ok(beforeBody.length > 0, "expected seeded documents to exist first");

    const response = await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    const body = (await response.json()) as DeleteResponse;

    assert.equal(response.status, 200);
    assert.equal(body.documentsPurged, beforeBody.length);

    const after = await fetch(`${baseUrl}/api/documents`);
    const afterBody = (await after.json()) as unknown[];
    assert.equal(afterBody.length, 0, "documents must actually be gone");
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

    const response = await fetch(`${baseUrl}/api/audit`);
    const body = (await response.json()) as { entries: Array<{ action: string }> };

    assert.ok(body.entries.some((entry) => entry.action === "DATA_DELETION_REQUEST"));
    assert.equal(verifyAuditChain().valid, true);
  });
});

test("the audit chain verifies over HTTP", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/audit/verify`);
    const body = (await response.json()) as { valid: boolean };

    assert.equal(response.status, 200);
    assert.equal(body.valid, true);
  });
});

test("purgeAllDocuments is idempotent", () => {
  assert.deepEqual(purgeAllDocuments(), []);
  assert.deepEqual(purgeAllDocuments(), []);
});