import { createHash, randomUUID } from "node:crypto";

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
 * In-process only: the chain is lost on restart and is not shared between
 * instances. A durable store is required before this can serve as evidence
 * of anything, which is why `verifyAuditChain` is exposed over HTTP rather
 * than trusted silently.
 */
const auditChain: AuditEntry[] = [];

function hashEntry(prevHash: string, entry: Omit<AuditEntry, "hash">): string {
  return createHash("sha256")
    .update(`${prevHash}|${entry.timestamp}|${entry.action}|${entry.userId}|${JSON.stringify(entry.payload)}`)
    .digest("hex");
}

/** Test hook: clears the chain so each test starts from genesis. */
export function resetAuditChain(): void {
  auditChain.length = 0;
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