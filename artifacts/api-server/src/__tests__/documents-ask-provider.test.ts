import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

process.env.APP_ENCRYPTION_KEY = "integration-test-key";
// Intentionally NOT setting MOCK_LLM here. This suite exists to prove the ask
// route constructs a real GroqProvider and calls it, so the provider's
// completeJson is stubbed at the prototype instead of being replaced wholesale.
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
async function createDocument(baseUrl: string, name: string, text: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain" }), `${name}.txt`);

  const created = await fetch(`${baseUrl}/api/documents/upload`, { method: "POST", body: form });
  assert.equal(created.status, 201);
  return ((await created.json()) as { id: string }).id;
}

async function askDocument(baseUrl: string, id: string, question: string) {
  return fetch(`${baseUrl}/api/documents/${id}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, perspective: "party_a" }),
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
      const id = await createDocument(
        baseUrl,
        "provider-routing",
        "1. Termination. Client may terminate this Agreement for convenience upon thirty (30) days written notice.",
      );

      const ask = await askDocument(baseUrl, id, "How do I terminate early?");
      const body = (await ask.json()) as AskResponse;

      assert.equal(ask.status, 200);
      assert.equal(calls.length, 1, "the provider's completeJson must be reached");
      assert.match(calls[0].system, /Answer only from the numbered clauses/);
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

test("a provider failure surfaces as 500, not a misleading 404", async () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalCompleteJson = GroqProvider.prototype.completeJson;

  delete process.env.GROQ_API_KEY;
  delete process.env.MOCK_LLM;
  GroqProvider.prototype.completeJson = async function () {
    throw new Error("GROQ_API_KEY is not configured.");
  };

  try {
    await withServer(async (baseUrl) => {
      const id = await createDocument(
        baseUrl,
        "failure-surfacing",
        "1. Termination. Either party may terminate on 30 days notice.",
      );

      const ask = await askDocument(baseUrl, id, "Term?");
      const body = (await ask.json()) as { error?: string };

      assert.equal(ask.status, 500, "an upstream failure is not a missing document");
      assert.match(body.error ?? "", /GROQ_API_KEY is not configured/);
    });
  } finally {
    GroqProvider.prototype.completeJson = originalCompleteJson;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("a genuinely unknown document still returns 404", async () => {
  await withServer(async (baseUrl) => {
    const ask = await askDocument(baseUrl, "doc-does-not-exist", "Term?");
    const body = (await ask.json()) as { error?: string };

    assert.equal(ask.status, 404);
    assert.equal(body.error, "Document not found");
  });
});
