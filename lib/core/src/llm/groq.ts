import { z } from "zod";
import type { LLMProvider } from "./base";

export type GroqConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export class GroqProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: GroqConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GROQ_API_KEY ?? "";
    this.model = config.model ?? process.env.GROQ_MODEL_FAST ?? "llama-3.1-8b-instant";
    this.baseUrl = config.baseUrl ?? "https://api.groq.com/openai/v1";
  }

  async completeJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    if (!this.apiKey) {
      throw new Error("GROQ_API_KEY is not configured.");
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq request failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const result = schema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`Validation failed: ${JSON.stringify(result.error.format())}`);
    }

    return result.data;
  }
}
