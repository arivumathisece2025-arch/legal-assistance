import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { GroqInvalidJsonError, GroqProvider, GroqRequestError } from "../llm/groq";

test("Groq failures expose only a stable error and log upstream details through the supplied callback", async () => {
  const logged: Array<{ status: number; body: string }> = [];
  let attempts = 0;

  const provider = new GroqProvider({
    apiKey: "test-key",
    fetch: async () => {
      attempts += 1;
      return new Response("secret-upstream-body", { status: 429 });
    },
    sleep: async () => undefined,
    onUpstreamError: (status, body) => logged.push({ status, body }),
  });
  await assert.rejects(
    provider.completeJson("document text", "question text", z.object({ answer: z.string() })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "LLM request failed");
      assert.equal((error as GroqRequestError).status, 429);
      assert.doesNotMatch(error.message, /secret-upstream-body/);
      return true;
    },
  );
  assert.equal(attempts, 3);
  assert.equal(logged.length, 3);
  assert.deepEqual(logged[0], { status: 429, body: "secret-upstream-body" });
});

test("Groq retries a 429 with Retry-After and succeeds on the second attempt", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const provider = new GroqProvider({
    apiKey: "test-key",
    model: "test-model",
    maxTokens: 321,
    fetch: async (_input, init) => {
      attempts += 1;
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(request.temperature, 0);
      assert.equal(request.max_tokens, 321);
      if (attempts === 1) return new Response("busy", { status: 429, headers: { "retry-after": "2" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "ok" }) } }] }));
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });

  const result = await provider.completeJson("system", "user", z.object({ answer: z.string() }));
  assert.deepEqual(result, { answer: "ok" });
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [2_000]);
});

test("Groq does not retry ordinary 4xx responses", async () => {
  let attempts = 0;
  const provider = new GroqProvider({
    apiKey: "test-key",
    fetch: async () => {
      attempts += 1;
      return new Response("bad request", { status: 400 });
    },
    sleep: async () => undefined,
  });

  await assert.rejects(provider.completeJson("system", "user", z.object({ answer: z.string() })), (error: unknown) => {
    assert.ok(error instanceof GroqRequestError);
    assert.equal(error.status, 400);
    return true;
  });
  assert.equal(attempts, 1);
});

test("Groq request timeout aborts the fetch signal", async () => {
  let sawAbortedSignal = false;
  const keepAlive = setInterval(() => undefined, 1_000);
  const provider = new GroqProvider({
    apiKey: "test-key",
    timeoutMs: 5,
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Expected a request signal");
      signal.addEventListener("abort", () => {
        sawAbortedSignal ||= signal.aborted;
        reject(new Error("aborted"));
      }, { once: true });
    }),
    sleep: async () => undefined,
  });

  try {
    await assert.rejects(provider.completeJson("system", "user", z.object({ answer: z.string() })), GroqRequestError);
    assert.equal(sawAbortedSignal, true);
  } finally {
    clearInterval(keepAlive);
  }
});

test("invalid JSON responses throw the typed Groq parse error", async () => {
  const provider = new GroqProvider({
    apiKey: "test-key",
    fetch: async () => new Response("not-json"),
    sleep: async () => undefined,
  });

  await assert.rejects(provider.completeJson("system", "user", z.object({ answer: z.string() })), GroqInvalidJsonError);
});

test("Groq parses SSE token deltas and returns the complete text", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const chunks = ["Hello", " world"].map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  chunks.push("data: [DONE]\n\n");
  const provider = new GroqProvider({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(chunks.join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const tokens: string[] = [];

  const completeText = await provider.completeText("system", "user", (token) => { tokens.push(token); });

  assert.equal(requestBody?.stream, true);
  assert.deepEqual(tokens, ["Hello", " world"]);
  assert.equal(completeText, "Hello world");
});