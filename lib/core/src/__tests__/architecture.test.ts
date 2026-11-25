import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(rootDir, "../../..");

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function walkTextFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkTextFiles(fullPath);
    return entry.isFile() && /\.(?:[cm]?js|[cm]?ts|jsx|tsx|json|html|css|md)$/i.test(entry.name) ? [fullPath] : [];
  });
}

test("lib/core does not import from artifacts", () => {
  const offenders: string[] = [];

  for (const file of walk(rootDir)) {
    const text = readFileSync(file, "utf8");
    if (/from\s+["'].*artifacts\//.test(text) || /import\s+.*["'].*artifacts\//.test(text)) {
      offenders.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(offenders, []);
});

test("source trees contain no dynamic function construction or eval", () => {
  const artifactRoot = path.join(repositoryRoot, "artifacts");
  const sourceDirectories = [path.join(repositoryRoot, "lib")];
  for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sourceDirectory = path.join(artifactRoot, entry.name, "src");
      try {
        readdirSync(sourceDirectory);
        sourceDirectories.push(sourceDirectory);
      } catch {
        // Artifacts without a source tree are outside the scan scope.
      }
    }
  }

  const dynamicFunctionPattern = new RegExp("Function" + "\\s*\\(");
  const evalPattern = new RegExp("eval" + "\\s*\\(");
  const offenders = sourceDirectories
    .flatMap(walkTextFiles)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return dynamicFunctionPattern.test(source) || evalPattern.test(source);
    })
    .map((file) => path.relative(repositoryRoot, file));

  assert.deepEqual(offenders, []);
});
