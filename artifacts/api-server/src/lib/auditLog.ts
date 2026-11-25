import { createHash, randomUUID } from "node:crypto";
import { persistAuditEntry } from "./auditStore";

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  userId: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

const GENESIS_HASH = "0".repeat(64);
const MAX_CHAIN_LENGTH = 10_000;

/**
 * Append-only, hash-chained audit log.
 *
 * Each entry commits to its predecessor, so editing or removing an entry in
 * the middle breaks every link after it and `verifyAuditChain` reports the
 * index of the first bad record.
 *
 * Entries are mirrored asynchronously when a durable store is configured;
 * each process still owns its own chain and persistence is best-effort.
 */
const auditChain: AuditEntry[] = [];
const pendingWrites = new Set<Promise<boolean>>();
let persistenceQueue = Promise.resolve();

export function hashAuditIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex");
}

function hashEntry(prevHash: string, entry: Omit<AuditEntry, "hash">): string {
  return createHash("sha256")
    .update(`${prevHash}|${entry.timestamp}|${entry.action}|${entry.userId}|${canonicalJson(entry.payload)}`)
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Test hook: clears the chain so each test starts from genesis. */
export function resetAuditChain(): void {
  auditChain.length = 0;
}

export function loadAuditChain(entries: AuditEntry[]): void {
  auditChain.length = 0;
  for (const entry of entries) {
    auditChain.push({ ...entry, payload: { ...entry.payload } });
  }
}

export async function flushAuditWrites(): Promise<void> {
  await Promise.all([...pendingWrites]);
}

export function appendAuditLog(
  action: string,
  userId: string,
  payload: Record<string, unknown> = {},
  now = new Date(),
): AuditEntry {
  if (auditChain.length >= MAX_CHAIN_LENGTH) {
    throw new Error("Audit chain is full; refusing to drop entries. Persist and rotate.");
  }

  const prevHash = auditChain.at(-1)?.hash ?? GENESIS_HASH;
  const unsigned: Omit<AuditEntry, "hash"> = {
    id: `audit_${randomUUID()}`,
    timestamp: now.toISOString(),
    action,
    userId,
    payload,
    prevHash,
  };

  const entry: AuditEntry = { ...unsigned, hash: hashEntry(prevHash, unsigned) };
  auditChain.push(entry);
  const pendingWrite = persistenceQueue.then(() => persistAuditEntry(entry)).catch(() => false);
  persistenceQueue = pendingWrite.then(() => undefined);
  pendingWrites.add(pendingWrite);
  void pendingWrite.finally(() => pendingWrites.delete(pendingWrite));
  return entry;
}

export function verifyAuditChain(): { valid: boolean; length: number; tamperedIndex?: number } {
  let currentHash = GENESIS_HASH;

  for (let index = 0; index < auditChain.length; index += 1) {
    const entry = auditChain[index]!;

    if (entry.prevHash !== currentHash) {
      return { valid: false, length: auditChain.length, tamperedIndex: index };
    }

    const { hash, ...unsigned } = entry;
    if (hashEntry(currentHash, unsigned) !== hash) {
      return { valid: false, length: auditChain.length, tamperedIndex: index };
    }

    currentHash = hash;
  }

  return { valid: true, length: auditChain.length };
}

export function listAuditLog(): AuditEntry[] {
  return auditChain.map((entry) => ({ ...entry }));
}

/**
 * Test-only escape hatch to the live chain so a test can simulate an
 * attacker editing history. Never call this from application code.
 */
export function __mutateChainForTest(mutate: (chain: AuditEntry[]) => void): void {
  mutate(auditChain);
}