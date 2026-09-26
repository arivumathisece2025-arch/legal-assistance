import { z } from "zod";
import { GroqProvider } from "./groq";
import type { LLMProvider } from "./base";

function readFixtureFile(fixturePath: string): unknown | undefined {
  if (typeof process === "undefined" || !process.versions?.node) {
    return undefined;
  }

  try {
    const nodeFs = Function("return require('node:fs')")() as typeof import("node:fs");
    const nodePath = Function("return require('node:path')")() as typeof import("node:path");
    const resolvedPath = nodePath.resolve(fixturePath);
    if (!nodeFs.existsSync(resolvedPath)) return undefined;
    return JSON.parse(nodeFs.readFileSync(resolvedPath, "utf8"));
  } catch {
    return undefined;
  }
}

export class MockProvider implements LLMProvider {
  private readonly fixtureDir: string;

  constructor(fixtureDir?: string) {
    this.fixtureDir = fixtureDir ?? "lib/core/src/fixtures";
  }

  async completeJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    const fixtureName = `${(schema.description ?? "default").toLowerCase().replace(/\s+/g, "-")}.json`;
    const fixturePath = `${this.fixtureDir}/${fixtureName}`;
    const fixtureData = readFixtureFile(fixturePath);

    if (fixtureData !== undefined) {
      const result = schema.safeParse(fixtureData);
      if (!result.success) {
        throw new Error(`Mock fixture validation failed: ${JSON.stringify(result.error.format())}`);
      }
      return result.data;
    }

    return {} as T;
  }
}

export function resolveProvider(): LLMProvider {
  if (typeof process !== "undefined" && process.env.MOCK_LLM === "1") {
    return new MockProvider();
  }

  return new GroqProvider();
}
