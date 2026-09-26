import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createLogger, hashContent, hashIdentifier, redactMeta } from "../lib/secureLogger";

test("hashContent returns a stable, truncated digest", () => {
  const text = "The Supplier shall indemnify the Customer.";
  const digest = hashContent(text);

  assert.equal(digest.length, 16);
  assert.equal(digest, hashContent(text));
  assert.equal(digest, createHash("sha256").update(text).digest("hex").slice(0, 16));
  assert.notEqual(digest, hashContent("a different clause"));
});

test("redactMeta replaces document text with a digest and its length", () => {
  const text = "The Supplier shall indemnify the Customer against all claims.";
  const safe = redactMeta({ documentText: text, documentId: "doc-001" });

  assert.equal(safe.documentText, undefined);
  assert.equal(safe.documentTextHash, hashContent(text));
  assert.equal(safe.documentTextLength, text.length);
  assert.equal(safe.documentId, "doc-001");
  assert.equal(JSON.stringify(safe).includes(text), false);
});

test("redactMeta strips prompts and questions too", () => {
  const prompt = "Summarise the termination clause for party B.";
  const question = "What is the notice period?";

  const safe = redactMeta({ prompt, question });

  assert.equal(safe.prompt, undefined);
  assert.equal(safe.question, undefined);
  assert.equal(safe.promptHash, hashContent(prompt));
  assert.equal(safe.questionHash, hashContent(question));
  assert.equal(JSON.stringify(safe).includes(prompt), false);
});

test("redactMeta recurses into nested objects", () => {
  const safe = redactMeta({
    documentId: "doc-001",
    nested: { documentText: "secret clause text", keep: "visible" },
  });

  const nested = safe.nested as { documentText?: string; documentTextHash?: string; keep: string };
  assert.equal(nested.documentText, undefined);
  assert.equal(nested.documentTextHash, hashContent("secret clause text"));
  assert.equal(nested.keep, "visible");
});

test("redactMeta hashes a known PII pattern without leaking it", () => {
  const aadhaar = "234567890124";
  const safe = redactMeta({ documentText: `Applicant Aadhaar ${aadhaar} on file.` });

  assert.equal(JSON.stringify(safe).includes(aadhaar), false);
});

test("hashIdentifier is stable and does not reveal the input", () => {
  const userId = "user-42";
  const hashed = hashIdentifier(userId);

  assert.equal(hashed.length, 16);
  assert.equal(hashed, hashIdentifier(userId));
  assert.equal(hashed.includes(userId), false);
});

test("createLogger emits JSON lines with the service and level", () => {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (line: string) => void lines.push(line);
  console.warn = (line: string) => void lines.push(line);
  console.error = (line: string) => void lines.push(line);

  try {
    const logger = createLogger("test-service");
    logger.info("hello", { documentId: "doc-001" });
    logger.warn("careful", { reason: "test" });
    logger.error("boom", { code: "E_TEST" });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.equal(lines.length, 3);

  const [info, warn, error] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(info!.level, "INFO");
  assert.equal(info!.service, "test-service");
  assert.equal(info!.message, "hello");
  assert.equal(warn!.level, "WARN");
  assert.equal(error!.level, "ERROR");
  assert.equal(error!.code, "E_TEST");
});

test("createLogger redacts document text before it reaches the sink", () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (line: string) => void lines.push(line);

  const secret = "The Supplier shall indemnify the Customer.";
  try {
    createLogger("redaction-test").info("processed", { documentText: secret });
  } finally {
    console.log = originalLog;
  }

  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.includes(secret), false, "raw document text must never be logged");
  assert.match(lines[0]!, /documentTextHash/);
});