import { z } from "zod";
import { GroqProvider } from "./groq";
import type { LLMProvider } from "./base";

/**
 * `node:*` access that works in both ESM and CJS without a static import.
 *
 * `Function("return require('node:fs')")` is the trick used elsewhere in this
 * package, but it throws "require is not defined" under the ESM loader, so it
 * silently disabled fixture loading. `process.getBuiltinModule` is the
 * supported replacement on Node 22.5+.
 */
function nodeBuiltin<T>(name: string): T | undefined {
  if (typeof process === "undefined" || !process.versions?.node) return undefined;
  try {
    const getBuiltinModule = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    if (typeof getBuiltinModule === "function") {
      return getBuiltinModule.call(process, name) as T;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readFixtureFile(fixturePath: string): unknown | undefined {
  const nodeFs = nodeBuiltin<typeof import("node:fs")>("node:fs");
  const nodePath = nodeBuiltin<typeof import("node:path")>("node:path");
  if (!nodeFs || !nodePath) return undefined;

  try {
    const resolvedPath = nodePath.resolve(fixturePath);
    if (!nodeFs.existsSync(resolvedPath)) return undefined;
    return JSON.parse(nodeFs.readFileSync(resolvedPath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Locates `lib/core/src/fixtures` without depending on process.cwd().
 *
 * Tries, in order: an explicit `CLAUSE_COMPASS_FIXTURES` override, the path
 * relative to this module (`import.meta.url`), then the historical cwd-relative
 * path. Returns the first candidate that exists, falling back to the
 * module-relative one so the error stays legible.
 */
function defaultFixtureDir(): string {
  const candidates: string[] = [];

  if (typeof process !== "undefined" && process.env?.["CLAUSE_COMPASS_FIXTURES"]) {
    candidates.push(process.env["CLAUSE_COMPASS_FIXTURES"]);
  }

  const nodePath = nodeBuiltin<typeof import("node:path")>("node:path");
  const nodeUrl = nodeBuiltin<typeof import("node:url")>("node:url");
  if (nodePath && nodeUrl) {
    // This file is lib/core/src/llm/mock.ts, so fixtures sit at ../../fixtures.
    candidates.push(nodePath.resolve(nodeUrl.fileURLToPath(import.meta.url), "..", "..", "fixtures"));
  }

  candidates.push("lib/core/src/fixtures");

  const nodeFs = nodeBuiltin<typeof import("node:fs")>("node:fs");
  if (nodeFs) {
    for (const candidate of candidates) {
      try {
        if (nodeFs.existsSync(candidate)) return candidate;
      } catch {
        // Ignore and try the next candidate.
      }
    }
  }

  return candidates[candidates.length - 1] ?? "lib/core/src/fixtures";
}

export class MockProvider implements LLMProvider {
  private readonly fixtureDir: string;

  constructor(fixtureDir?: string) {
    // A bare relative path resolves against process.cwd(), which is the
    // *consuming package* when the api-server runs its own suite. From
    // artifacts/api-server, "lib/core/src/fixtures" does not exist, so every
    // schema silently fell through to the `{}` fallback and failed validation
    // with a 500. Resolve upward from this module instead, and keep the cwd
    // lookup as a fallback so an explicit relative path still works.
    this.fixtureDir = fixtureDir ?? defaultFixtureDir();
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
