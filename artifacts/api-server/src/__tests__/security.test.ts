import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createServer } from "node:http";
import { parseSession, SESSION_COOKIE } from "../middlewares/session";
import { rateLimit, resetRateLimits } from "../middlewares/rateLimit";

process.env.APP_ENCRYPTION_KEY = "middleware-test-key";
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

type FakeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  setHeader(key: string, value: string): void;
  status(code: number): FakeResponse;
  json(): void;
};

/**
 * Minimal stand-in for an Express response. Only the members `rateLimit`
 * actually touches are implemented; the cast keeps the test honest about
 * that rather than building a full response object.
 */
function fakeResponse(onDone: (status: number) => void): FakeResponse {
  const response: FakeResponse = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      onDone(response.statusCode);
    },
  };
  return response;
}

beforeEach(() => {
  resetRateLimits();
});

test("security headers are present on API responses", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/healthz`);

    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  });
});

test("HSTS is withheld over plain HTTP in development", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/healthz`);
    assert.equal(response.headers.get("strict-transport-security"), null);
  });
});

test("the session cookie is httpOnly, SameSite=Strict and path-scoped", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/healthz`);
    const cookie = response.headers.get("set-cookie") ?? "";

    assert.match(cookie, new RegExp(`${SESSION_COOKIE}=`));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//i);
  });
});

test("CSRF protection rejects a state-changing request with no token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/data/delete`, { method: "POST" });

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /CSRF/);
  });
});

test("CSRF protection rejects a mismatched token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { "x-csrf-token": "definitely-not-the-session-token" },
    });

    assert.equal(response.status, 403);
  });
});

test("CSRF protection admits a request echoing the session token", async () => {
  await withServer(async (baseUrl) => {
    const bootstrap = await fetch(`${baseUrl}/api/healthz`);
    const rawValue = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(bootstrap.headers.get("set-cookie") ?? "")?.[1];
    assert.ok(rawValue);

    const session = parseSession(decodeURIComponent(rawValue));
    assert.ok(session);

    const response = await fetch(`${baseUrl}/api/data/delete`, {
      method: "POST",
      headers: { "x-csrf-token": session.csrfToken, cookie: `${SESSION_COOKIE}=${rawValue}` },
    });

    assert.equal(response.status, 200);
  });
});

test("safe methods bypass the CSRF check", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/audit/verify`);
    assert.equal(response.status, 200);
  });
});

test("the rate limiter returns 429 once the bucket is empty", async () => {
  const limited = rateLimit({ limit: 2, intervalMs: 60_000 });
  let reachedHandler = 0;

  const run = () =>
    new Promise<number>((resolve) => {
      limited(
        { ip: "203.0.113.7", method: "GET" } as never,
        fakeResponse((status) => resolve(status)) as never,
        () => {
          reachedHandler += 1;
          resolve(200);
        },
      );
    });

  assert.equal(await run(), 200);
  assert.equal(await run(), 200);
  assert.equal(await run(), 429, "third request should be throttled");
  assert.equal(reachedHandler, 2, "throttled requests must not reach the handler");
});

test("rate limiting keys on client IP, not the destination host", async () => {
  const limited = rateLimit({ limit: 1, intervalMs: 60_000 });

  const invoke = (ip: string) =>
    new Promise<number>((resolve) => {
      limited(
        { ip, method: "GET" } as never,
        fakeResponse((status) => resolve(status)) as never,
        () => resolve(200),
      );
    });

  assert.equal(await invoke("198.51.100.10"), 200);
  // A different client must not be throttled by the first one's usage.
  assert.equal(await invoke("198.51.100.11"), 200);
  // The original client is now empty.
  assert.equal(await invoke("198.51.100.10"), 429);
});