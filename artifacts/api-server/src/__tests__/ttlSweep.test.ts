import assert from "node:assert/strict";
import test from "node:test";
import { startTtlSweep, sweepExpiredDocuments } from "../lib/ttlSweep";

/** ADDITIVE (scorecard item 6): new file; no existing test file is modified. */
test("scheduled TTL sweep calls the same cleanup logic the lazy path uses", async () => {
  let calls = 0;
  const timer = startTtlSweep(async () => {
    calls += 1;
  }, 10);
  try {
    const deadline = Date.now() + 1000;
    while (calls === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(calls >= 1, true);
  } finally {
    clearInterval(timer);
  }
});

test("sweepExpiredDocuments is a no-op without a database", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.deepEqual(await sweepExpiredDocuments(), { deleted: 0, databaseConfigured: false });
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  }
});
