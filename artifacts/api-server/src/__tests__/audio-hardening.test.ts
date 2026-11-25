import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { resetRateLimits } from "../middlewares/rateLimit";
import { sessionHeaders } from "./csrfTestUtils";

process.env.APP_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
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

function audioForm(mimetype = "audio/webm", size = 4): FormData {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(size)], { type: mimetype }), "voice.audio");
  form.append("language", "en");
  return form;
}

async function postAudio(baseUrl: string, auth: { cookie: string; csrfToken: string }, form: FormData) {
  return fetch(`${baseUrl}/api/audio/transcribe`, {
    method: "POST",
    headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
    body: form,
  });
}

test("audio transcription rejects unlisted MIME types with 415", async () => {
  await withServer(async (baseUrl) => {
    const auth = await sessionHeaders(baseUrl);
    const response = await postAudio(baseUrl, auth, audioForm("application/octet-stream"));

    assert.equal(response.status, 415);
    assert.equal((await response.json() as { code: string }).code, "UNSUPPORTED_AUDIO_TYPE");
  });
});

test("audio transcription rejects payloads larger than 5 MB with 413", async () => {
  await withServer(async (baseUrl) => {
    const auth = await sessionHeaders(baseUrl);
    const response = await postAudio(baseUrl, auth, audioForm("audio/webm", 5 * 1024 * 1024 + 1));

    assert.equal(response.status, 413);
    assert.equal((await response.json() as { code: string }).code, "AUDIO_TOO_LARGE");
  });
});

test("audio transcription allows ten requests per minute and rejects the eleventh", async () => {
  resetRateLimits();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.groq.com/")) {
      return new Response(JSON.stringify({ text: "transcribed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    await withServer(async (baseUrl) => {
      const auth = await sessionHeaders(baseUrl);
      for (let request = 1; request <= 10; request += 1) {
        assert.equal((await postAudio(baseUrl, auth, audioForm())).status, 200);
      }
      assert.equal((await postAudio(baseUrl, auth, audioForm())).status, 429);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});