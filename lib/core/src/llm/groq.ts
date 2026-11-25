import { z } from "zod";
import type { LLMProvider } from "./base";

export type GroqConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxTokens?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  onUpstreamError?: (status: number, body: string) => void;
};

export class GroqRequestError extends Error {
  readonly code = "LLM_REQUEST_FAILED";
  readonly status?: number;

  constructor(status?: number) {
    super("LLM request failed");
    this.name = "GroqRequestError";
    this.status = status;
  }
}

export class GroqInvalidJsonError extends Error {
  readonly code = "LLM_INVALID_JSON";

  constructor() {
    super("LLM returned an invalid JSON response");
    this.name = "GroqInvalidJsonError";
  }
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

export class GroqProvider implements LLMProvider {
  readonly modelLabel: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly fetchImplementation?: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly onUpstreamError?: (status: number, body: string) => void;

  constructor(config: GroqConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GROQ_API_KEY ?? "";
    this.model = config.model ?? process.env.GROQ_MODEL_FAST ?? "llama-3.1-8b-instant";
    this.modelLabel = this.model;
    this.baseUrl = config.baseUrl ?? "https://api.groq.com/openai/v1";
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxTokens = config.maxTokens ?? 1024;
    this.fetchImplementation = config.fetch;
    this.sleep = config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.onUpstreamError = config.onUpstreamError;
  }

  async completeJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.request({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: this.maxTokens,
    });

    let payload: { choices?: Array<{ message?: { content?: string } }> };
    try {
      payload = JSON.parse(await response.text()) as typeof payload;
    } catch {
      throw new GroqInvalidJsonError();
    }

    const content = payload.choices?.[0]?.message?.content;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content ?? "{}");
    } catch {
      throw new GroqInvalidJsonError();
    }
    const result = schema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`Validation failed: ${JSON.stringify(result.error.format())}`);
    }

    return result.data;
  }

  async completeText(
    system: string,
    user: string,
    onToken: (token: string) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.request({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: this.maxTokens,
      stream: true,
    }, signal);

    let fullText = "";
    let pending = "";
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    if (!reader) throw new Error("LLM stream was empty");

    const consumeLine = async (line: string): Promise<boolean> => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return true;
      let payload: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        payload = JSON.parse(data) as typeof payload;
      } catch {
        throw new GroqInvalidJsonError();
      }
      const token = payload.choices?.[0]?.delta?.content;
      if (token) {
        fullText += token;
        await onToken(token);
      }
      return false;
    };

    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (await consumeLine(line)) {
          finished = true;
          break;
        }
      }
    }
    pending += decoder.decode();
    if (!finished && pending.trim()) await consumeLine(pending);
    return fullText;
  }

  private async request(body: Record<string, unknown>, externalSignal?: AbortSignal): Promise<Response> {
    if (!this.apiKey) throw new Error("GROQ_API_KEY is not configured.");
    const fetchImplementation = this.fetchImplementation ?? globalThis.fetch;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const signal = externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
      let response: Response;
      try {
        response = await fetchImplementation(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (externalSignal?.aborted) throw new GroqRequestError();
        if (attempt + 1 >= MAX_ATTEMPTS) throw new GroqRequestError();
        await this.sleep(backoffDelay(attempt));
        continue;
      }

      if (response.ok) return response;
      const upstreamBody = await response.text();
      this.onUpstreamError?.(response.status, upstreamBody);
      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt + 1 >= MAX_ATTEMPTS) throw new GroqRequestError(response.status);
      await this.sleep(retryAfterMs(response.headers.get("retry-after")) ?? backoffDelay(attempt));
    }

    throw new GroqRequestError();
  }
}

function backoffDelay(attempt: number): number {
  const delay = BASE_BACKOFF_MS * 2 ** attempt;
  return delay + Math.floor(Math.random() * delay);
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now());
}
