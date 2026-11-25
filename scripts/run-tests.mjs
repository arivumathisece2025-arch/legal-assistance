import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const coverage = args.includes("--coverage") || process.env.COVERAGE === "1";
const testDirectory = path.resolve(process.cwd(), args.find((arg) => arg !== "--coverage") ?? "src/__tests__");

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(file);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [file] : [];
  });
}

const tests = findTests(testDirectory).sort();
if (tests.length === 0) {
  console.error(`No test files found under ${testDirectory}`);
  process.exitCode = 1;
} else {
  const commandArgs = ["--import", "tsx", "--test"];
  if (coverage) commandArgs.push("--experimental-test-coverage");
  commandArgs.push(...tests);
  const result = spawnSync(process.execPath, commandArgs, { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}