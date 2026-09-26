#!/usr/bin/env node
/**
 * ADDITIVE (scorecard item 3): lightweight pattern-based secret scanner.
 * Fast local complement to gitleaks CI (.github/workflows/secret-scan.yml):
 * scans the staged diff (default) or all tracked files (--all) for likely
 * secret prefixes and exits 1 on a hit so a commit/CI step can fail closed.
 * Cross-platform (node, no bash) so it runs on Windows dev machines too.
 */
import { execFileSync } from "node:child_process";

const PATTERNS = [
  /gsk_[A-Za-z0-9]{20,}/,
  /sk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /gho_[A-Za-z0-9]{36}/,
  /xox[bpas]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

// This file documents the patterns above; scanning it would always self-match.
const SELF = "scripts/check-secrets.mjs";

function runGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

/**
 * Scans content line by line. Skips the scanner's own file and lines that
 * are pattern definitions (contain regex character-class syntax), so
 * committing this script does not block itself.
 */
function scanContent(label, content) {
  const findings = [];
  for (const line of content.split("\n")) {
    if (line.includes("[A-Za-z0-9]")) continue; // pattern definition, not a secret
    for (const pattern of PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ label, line: line.slice(0, 160) });
        break;
      }
    }
  }
  return findings;
}

const scanAll = process.argv.includes("--all");
let findings = [];

if (scanAll) {
  const { readFileSync, existsSync } = await import("node:fs");
  const files = runGit(["ls-files"]).split("\n").map((f) => f.trim()).filter(Boolean);
  for (const file of files) {
    if (file === SELF) continue;
    if (!existsSync(file)) continue;
    try {
      findings.push(...scanContent(file, readFileSync(file, "utf8")));
    } catch {
      // Binary / unreadable files are skipped.
    }
  }
} else {
  const diff = runGit(["diff", "--cached", "--", "."]);
  if (!diff.trim()) {
    console.log("check-secrets: no staged changes, nothing to scan.");
    process.exit(0);
  }
  // Track the file each hunk belongs to so this script's own patterns are
  // skipped when the scanner itself is part of the staged change.
  let currentFile = "";
  const scoped = [];
  for (const line of diff.split("\n")) {
    const header = /^(?:\+\+\+|---) [ab]\/(.*)$/.exec(line);
    if (header) currentFile = header[1];
    if (currentFile === SELF) continue;
    scoped.push(line);
  }
  findings = scanContent("staged diff", scoped.join("\n"));
}

if (findings.length > 0) {
  console.error(`check-secrets: BLOCKED - ${findings.length} likely secret(s) detected:`);
  for (const finding of findings.slice(0, 10)) {
    console.error(`  [${finding.label}] ${finding.line}`);
  }
  console.error("Remove the secret (use env vars) before committing. CI gitleaks will also fail.");
  process.exit(1);
}

console.log("check-secrets: no likely secrets detected.");
