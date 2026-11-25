import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { sessionHeaders } from "./csrfTestUtils";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// Intentionally NOT setting MOCK_LLM here. This suite proves the ask route
// constructs and calls a real GroqProvider rather than an inline stub.
delete process.env.MOCK_LLM;

const { default: app } = await import("../app");
const { GroqProvider } = await import("@workspace/core");

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

type AskResponse = {
  answer: string;
  citations: Array<{ clauseId: string }>;
  groundingRatio: number;
  adviceMode: boolean;
};

/**
 * `POST /api/documents` only creates an empty workspace record (its body takes
 * name/fileType/sizeBytes, not text), so the upload route is used here to get a
 * document that actually has segmented clauses to retrieve.
 */
async function createDocument(baseUrl: string, name: string, text: string, auth: { cookie: string; csrfToken: string }): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain" }), `${name}.txt`);

  const originalMock = process.env.MOCK_LLM;
  process.env.MOCK_LLM = "1";
  try {
    const created = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      body: form,
    });
    assert.equal(created.status, 201);
    return ((await created.json()) as { id: string }).id;
  } finally {
    if (originalMock === undefined) delete process.env.MOCK_LLM;
    else process.env.MOCK_LLM = originalMock;
  }
}

async function askDocument(baseUrl: string, id: string, question: string, auth: { cookie: string; csrfToken: string }, language: "en" | "ta" | "hi" = "en") {
  return fetch(`${baseUrl}/api/documents/${id}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ question, perspective: "party_a", language }),
  });
}

/**
 * Regression: `answerDocumentQuestion` used to build an inline object literal
 * whose `completeJson` string-concatenated the top-ranked clause. It was never
 * an LLM call - it ignored the system prompt and the configured models. This
 * test fails against that stub and passes only when the route resolves a real
 * provider and delegates to `answerQuestion`.
 */
test("the ask route calls a real provider instead of the inline quote stub", async () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalSmart = process.env.GROQ_MODEL_SMART;

  process.env.GROQ_API_KEY = "test-key-not-a-real-credential";
  process.env.GROQ_MODEL_SMART = "test-smart-model";

  const calls: Array<{ system: string; user: string }> = [];
  // Spy on the real provider rather than substituting one, so a regression back
  // to the inline stub (which never touches this method) stays detectable.
  const originalCompleteJson = GroqProvider.prototype.completeJson;
  GroqProvider.prototype.completeJson = async function (
    _system: string,
    _user: string,
    schema: { parse: (value: unknown) => unknown },
  ) {
    calls.push({ system: _system, user: _user });
    return schema.parse({ answer: "Client may terminate on thirty days notice. [C1]" }) as never;
  };

  try {
    await withServer(async (baseUrl) => {
      const auth = await sessionHeaders(baseUrl);

      const id = await createDocument(
        baseUrl,
        "provider-routing",
        "1. Termination. Client may terminate this Agreement for convenience upon thirty (30) days written notice.",
        auth,
      );

      const ask = await askDocument(baseUrl, id, "How do I terminate early?", auth, "hi");
      const body = (await ask.json()) as AskResponse;

      assert.equal(ask.status, 200);
      assert.equal(calls.length, 1, "the provider's completeJson must be reached");
      assert.match(calls[0].system, /Answer only from the numbered clauses/);
      assert.match(calls[0].system, /Answer in hi/);
      assert.match(calls[0].user, /How do I terminate early\?/);
      assert.ok(Array.isArray(body.citations));
      assert.equal(typeof body.groundingRatio, "number");
    });
  } finally {
    GroqProvider.prototype.completeJson = originalCompleteJson;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalSmart === undefined) delete process.env.GROQ_MODEL_SMART;
    else process.env.GROQ_MODEL_SMART = originalSmart;
  }
});

test("document and shared question SSE routes stream token events before grounded answers", async () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalCompleteText = GroqProvider.prototype.completeText;
  process.env.GROQ_API_KEY = "test-key-not-a-real-credential";
  let streamedCalls = 0;
  const streamSystems: string[] = [];
  GroqProvider.prototype.completeText = async function (_system, user, onToken) {
    streamedCalls += 1;
    streamSystems.push(_system);
    const clauseId = /\[([^\]]+)\]/.exec(user)?.[1] ?? "C1";
    const first = "Client may terminate on ";
    const second = `30 days notice. [${clauseId}]`;
    await onToken(first);
    await onToken(second);
    return `${first}${second}`;
  };

  try {
    await withServer(async (baseUrl) => {
      const auth = await sessionHeaders(baseUrl);
      const id = await createDocument(
        baseUrl,
        "streaming",
        "1. Termination. Client may terminate this Agreement on 30 days written notice.",
        auth,
      );

      const docResponse = await fetch(`${baseUrl}/api/documents/${id}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
        body: JSON.stringify({ question: "How can termination happen?", perspective: "party_a", language: "hi" }),
      });
      const docEvents = await docResponse.text();
      assert.equal(docResponse.status, 200);
      assert.equal((docEvents.match(/event: token/g) ?? []).length, 2);
      assert.match(docEvents, /event: answer\ndata: .*"citations":\[\{"clauseId":"C1"/);
      assert.match(docEvents, /"groundingRatio":/);

      const questionsResponse = await fetch(`${baseUrl}/api/questions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
        body: JSON.stringify({ documentId: id, question: "What is the notice period?", perspective: "party_a", language: "ta" }),
      });
      const questionEvents = await questionsResponse.text();
      assert.equal(questionsResponse.status, 200);
      assert.equal((questionEvents.match(/event: token/g) ?? []).length, 2);
      assert.match(questionEvents, /event: answer/);
      assert.equal(streamedCalls, 2);
      assert.ok(streamSystems.some((system) => /Answer in hi/.test(system)));
      assert.ok(streamSystems.some((system) => /Answer in ta/.test(system)));
    });
  } finally {
    GroqProvider.prototype.completeText = originalCompleteText;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("disconnecting an SSE client aborts the upstream completion signal", async () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalCompleteText = GroqProvider.prototype.completeText;
  process.env.GROQ_API_KEY = "test-key-not-a-real-credential";
  let resolveStarted!: () => void;
  let resolveAborted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const aborted = new Promise<void>((resolve) => { resolveAborted = resolve; });
  GroqProvider.prototype.completeText = async function (_system, _user, _onToken, signal) {
    resolveStarted();
    return await new Promise<string>((_resolve, reject) => {
      const onAbort = () => {
        resolveAborted();
        reject(new Error("client disconnected"));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  try {
    await withServer(async (baseUrl) => {
      const auth = await sessionHeaders(baseUrl);
      const id = await createDocument(baseUrl, "disconnect", "1. Termination. Either party may terminate with notice.", auth);
      const client = new AbortController();
      const fetchPromise = fetch(`${baseUrl}/api/documents/${id}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
        body: JSON.stringify({ question: "Explain termination?", perspective: "party_a" }),
        signal: client.signal,
      });

      await started;
      client.abort();
      await Promise.allSettled([fetchPromise]);
      await aborted;
    });
  } finally {
    GroqProvider.prototype.completeText = originalCompleteText;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("a provider failure surfaces as 500, not a misleading 404", async () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const secureLogLines: string[] = [];

  process.env.GROQ_API_KEY = "test-key-not-a-real-credential";
  delete process.env.MOCK_LLM;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.groq.com/")) {
      return new Response("secret-upstream-body", { status: 429 });
    }
    return originalFetch(input, init);
  };
  console.error = (...args: unknown[]) => secureLogLines.push(args.map(String).join(" "));

  try {
    await withServer(async (baseUrl) => {
      const auth = await sessionHeaders(baseUrl);

      const id = await createDocument(
        baseUrl,
        "failure-surfacing",
        "1. Termination. Either party may terminate on 30 days notice.",
        auth,
      );

      const ask = await askDocument(baseUrl, id, "Term?", auth);
      const body = (await ask.json()) as { error?: string };

      assert.equal(ask.status, 500, "an upstream failure is not a missing document");
      assert.equal((body as { code?: string; message?: string }).code, "ASK_FAILED");
      assert.equal((body as { code?: string; message?: string }).message, "Answer could not be generated.");
      assert.doesNotMatch(JSON.stringify(body), /secret-upstream-body/);
      assert.doesNotMatch(secureLogLines.join(" "), /secret-upstream-body/);
      assert.doesNotMatch(secureLogLines.join(" "), /Either party may terminate/);
      assert.match(secureLogLines.join(" "), /bodyHash/);
      assert.match(secureLogLines.join(" "), /bodyLength/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("a genuinely unknown document still returns 404", async () => {
  await withServer(async (baseUrl) => {
    const auth = await sessionHeaders(baseUrl);
    const ask = await askDocument(baseUrl, "doc-does-not-exist", "Term?", auth);
    const body = (await ask.json()) as { error?: string };

    assert.equal(ask.status, 404);
    assert.equal(body.error, "Document not found");
  });
});
