import assert from "node:assert/strict";
import test from "node:test";
import {
  createSession,
  parseSession,
  serializeSession,
} from "../middlewares/session";

process.env.APP_ENCRYPTION_KEY = "middleware-test-key";

test("a session round-trips through serialize and parse", () => {
  const session = createSession("user-1");
  const parsed = parseSession(serializeSession(session));

  assert.ok(parsed);
  assert.equal(parsed.userId, "user-1");
  assert.equal(parsed.csrfToken, session.csrfToken);
});

test("a forged session cookie claiming another user is rejected", () => {
  // The original spec base64-encoded unsigned JSON, so anyone could mint
  // `{"userId":"victim"}` and delete another user's data.
  const forged = Buffer.from(
    JSON.stringify({ userId: "victim", csrfToken: "attacker-token", issuedAt: Date.now() }),
  ).toString("base64url");

  assert.equal(parseSession(`${forged}.not-a-real-signature`), null);
});

test("a tampered payload fails signature verification", () => {
  const session = createSession("user-1");
  const [, signature] = serializeSession(session).split(".");

  // Swap the userId while keeping the original signature.
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...session, userId: "attacker" }),
  ).toString("base64url");

  assert.equal(parseSession(`${tamperedPayload}.${signature}`), null);
});

test("a payload with no signature at all is rejected", () => {
  const payload = Buffer.from(JSON.stringify(createSession("user-1"))).toString("base64url");
  assert.equal(parseSession(payload), null);
});

test("an expired session is rejected", () => {
  const old = createSession("user-1", Date.now() - 9 * 60 * 60 * 1000);
  assert.equal(parseSession(serializeSession(old)), null);
});

test("garbage input is rejected rather than throwing", () => {
  for (const value of ["", "not-base64", "a.b", "...", "%%%.%%%"]) {
    assert.equal(parseSession(value), null);
  }
});

test("two sessions for the same user get distinct CSRF tokens", () => {
  const first = createSession("user-1");
  const second = createSession("user-1");
  assert.notEqual(first.csrfToken, second.csrfToken);
});