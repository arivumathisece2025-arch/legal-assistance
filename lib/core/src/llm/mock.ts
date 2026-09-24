import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GroqProvider } from "./groq";
import type { LLMProvider } from "./base";

export class MockProvider implements LLMProvider {
  private readonly fixtureDir: string;

  constructor(fixtureDir?: string) {
    this.fixtureDir = fixtureDir ?? path.resolve(process.cwd(), "lib/core/src/fixtures");
  }

  async completeJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    const fixtureName = `${(schema.description ?? "default").toLowerCase().replace(/\s+/g, "-")}.json`;
    const fixturePath = path.join(this.fixtureDir, fixtureName);

    if (existsSync(fixturePath)) {
      const raw = readFileSync(fixturePath, "utf8");
      const parsed = JSON.parse(raw);
      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`Mock fixture validation failed: ${JSON.stringify(result.error.format())}`);
      }
      return result.data;
    }

    return {} as T;
  }
}

export function resolveProvider(): LLMProvider {
  if (process.env.MOCK_LLM === "1") {
    return new MockProvider();
  }

  return new GroqProvider();
}
