import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ADDITIVE (scorecard item 3): proves the pre-commit secret scanner actually
 * flags a fake test secret and passes on clean content. New file.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCANNER = join(REPO_ROOT, "scripts", "check-secrets.mjs");

function runScanner(cwd: string): { status: number; output: string } {
  try {
    const output = execFileSync("node", [SCANNER], { cwd, encoding: "utf8" });
    return { status: 0, output };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "check-secrets-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

test("check-secrets flags a fake key in staged changes", () => {
  const dir = initRepo();
  writeFileSync(join(dir, "app.ts"), `export const key = "gsk_abcdefghij1234567890abcdef";\n`);
  execFileSync("git", ["add", "app.ts"], { cwd: dir });
  const result = runScanner(dir);
  assert.equal(result.status, 1);
  assert.match(result.output, /BLOCKED|likely secret/);
});

test("check-secrets passes on clean staged changes", () => {
  const dir = initRepo();
  writeFileSync(join(dir, "app.ts"), `export const greeting = "hello world";\n`);
  execFileSync("git", ["add", "app.ts"], { cwd: dir });
  const result = runScanner(dir);
  assert.equal(result.status, 0);
  assert.match(result.output, /no likely secrets/i);
});
