import { createHash } from "node:crypto";

/** Keys whose values are raw user content and must never reach a log sink. */
const REDACTED_KEYS = new Set(["documentText", "prompt", "question", "text", "body", "clauseText"]);

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export type SafeMeta = Record<string, unknown>;

/**
 * Replaces raw document and prompt text with a truncated SHA-256 digest.
 *
 * A digest is enough to correlate repeated requests in the log without
 * storing the contract clause itself, which is what the DPDP Act 2023
 * storage-limitation principle asks for.
 */
export function redactMeta(meta: SafeMeta): SafeMeta {
  const safe: SafeMeta = {};

  for (const [key, value] of Object.entries(meta)) {
    if (REDACTED_KEYS.has(key)) {
      if (typeof value === "string") {
        safe[`${key}Hash`] = hashContent(value);
        safe[`${key}Length`] = value.length;
      } else {
        safe[`${key}Hash`] = hashContent(JSON.stringify(value ?? ""));
      }
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      safe[key] = redactMeta(value as SafeMeta);
      continue;
    }

    safe[key] = value;
  }

  return safe;
}

export type StructuredLogger = {
  info(message: string, meta?: SafeMeta): void;
  error(message: string, meta?: SafeMeta): void;
  warn(message: string, meta?: SafeMeta): void;
};

/**
 * JSON-lines logger that redacts before writing.
 *
 * `error` deliberately does not redact: the redaction is applied by
 * `redactMeta` on the same path as `info`, so both are safe, and error
 * metadata is limited to codes and counts by the callers in this package.
 */
export function createLogger(service: string): StructuredLogger {
  const write = (level: "INFO" | "WARN" | "ERROR", message: string, meta: SafeMeta = {}): void => {
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service,
      message,
      ...redactMeta(meta),
    });

    if (level === "ERROR") {
      console.error(record);
      return;
    }
    if (level === "WARN") {
      console.warn(record);
      return;
    }
    console.log(record);
  };

  return {
    info: (message, meta) => write("INFO", message, meta),
    warn: (message, meta) => write("WARN", message, meta),
    error: (message, meta) => write("ERROR", message, meta),
  };
}