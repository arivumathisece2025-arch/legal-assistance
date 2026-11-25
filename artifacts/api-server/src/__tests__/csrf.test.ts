import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { listAuditLog, resetAuditChain } from "../lib/auditLog";
import { parseSession } from "../middlewares/session";
import { sessionHeaders } from "./csrfTestUtils";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MOCK_LLM = "1";
process.env.GROQ_API_KEY = "test-audio-key";
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

function audioForm(): FormData {
  const form = new FormData();
  form.append("audio", new Blob(["sample audio"], { type: "audio/webm" }), "voice.webm");
  form.append("language", "en");
  return form;
}

test("GET /api/session returns a CSRF token bound to the session cookie", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/session`);
    const body = (await response.json()) as { csrfToken: string };
    const cookieValue = /cc_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    assert.ok(cookieValue);
    const session = parseSession(decodeURIComponent(cookieValue));

    const secondResponse = await fetch(`${baseUrl}/api/session`);
    const secondCookieValue = /cc_session=([^;]+)/.exec(secondResponse.headers.get("set-cookie") ?? "")?.[1];
    assert.ok(secondCookieValue);
    const secondSession = parseSession(decodeURIComponent(secondCookieValue));

    assert.equal(response.status, 200);
    assert.match(body.csrfToken, /^[0-9a-f]{64}$/);
    assert.match(response.headers.get("set-cookie") ?? "", /cc_session=/);
    assert.ok(session && secondSession);
    assert.match(session.userId, /^[0-9a-f-]{36}$/);
    assert.notEqual(session.userId, secondSession.userId);
  });
});

test("all requested state-changing routes reject requests without a CSRF token", async () => {
  resetAuditChain();
  await withServer(async (baseUrl) => {
    const requests: Array<() => Promise<Response>> = [
      () => {
        const form = new FormData();
        form.append("file", new Blob(["1. Clause."], { type: "text/plain" }), "contract.txt");
        return fetch(`${baseUrl}/api/documents/upload`, { method: "POST", body: form });
      },
      () => fetch(`${baseUrl}/api/documents/doc-001/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Summarize this document.", perspective: "party_a" }),
      }),
      () => fetch(`${baseUrl}/api/documents/doc-002/compare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ against: "doc-001" }),
      }),
      () => fetch(`${baseUrl}/api/questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: "doc-001", question: "Summarize this document.", perspective: "party_a" }),
      }),
      () => fetch(`${baseUrl}/api/audio/transcribe`, { method: "POST", body: audioForm() }),
    ];

    for (const request of requests) {
      assert.equal((await request()).status, 403);
    }
    assert.equal(listAuditLog().filter((entry) => entry.action === "SESSION_CSRF_REJECTED").length, requests.length);
  });
});

test("a valid session token reaches upload, ask, compare, question and transcription handlers", async () => {
  resetAuditChain();
  await withServer(async (baseUrl) => {
    const auth = await sessionHeaders(baseUrl);
    const headers = { cookie: auth.cookie, "x-csrf-token": auth.csrfToken };
    const form = new FormData();
    form.append("file", new Blob(["1. Clause. Either party may terminate with notice."], { type: "text/plain" }), "contract.txt");
    const upload = await fetch(`${baseUrl}/api/documents/upload`, { method: "POST", headers, body: form });
    assert.equal(upload.status, 201);

    const ask = await fetch(`${baseUrl}/api/documents/doc-001/ask`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ question: "Summarize this document.", perspective: "party_a" }),
    });
    assert.equal(ask.status, 200);

    const compare = await fetch(`${baseUrl}/api/documents/doc-002/compare`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ against: "doc-001" }),
    });
    assert.equal(compare.status, 200);

    const question = await fetch(`${baseUrl}/api/questions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ documentId: "doc-001", question: "Summarize this document.", perspective: "party_a" }),
    });
    assert.equal(question.status, 200);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith("https://api.groq.com/")) {
        return new Response(JSON.stringify({ text: "transcribed words" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
    try {
      const audio = await fetch(`${baseUrl}/api/audio/transcribe`, { method: "POST", headers, body: audioForm() });
      assert.equal(audio.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const entries = listAuditLog();
    const uploadEntry = entries.find((entry) => entry.action === "DOCUMENT_UPLOAD");
    const askEntry = entries.find((entry) => entry.action === "DOCUMENT_ASK");
    const compareEntry = entries.find((entry) => entry.action === "DOCUMENT_COMPARE");
    const audioEntry = entries.find((entry) => entry.action === "AUDIO_TRANSCRIBE");
    assert.ok(uploadEntry && askEntry && compareEntry && audioEntry);
    assert.match(String(uploadEntry.payload.documentIdHash), /^[0-9a-f]{64}$/);
    assert.match(String(askEntry.payload.documentIdHash), /^[0-9a-f]{64}$/);
    assert.match(String(compareEntry.payload.baseDocumentIdHash), /^[0-9a-f]{64}$/);
    assert.match(String(compareEntry.payload.revisedDocumentIdHash), /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(entries), /Either party may terminate/);
  });
});