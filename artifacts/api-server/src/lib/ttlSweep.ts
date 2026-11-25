/**
 * Standalone database TTL sweep for stored documents. No-op when DATABASE_URL
 * is unset. No new dependency: plain setInterval, unref'd so tests exit.
 */
export async function sweepExpiredDocuments(now = new Date()): Promise<{ deleted: number; databaseConfigured: boolean }> {
  if (!process.env.DATABASE_URL) return { deleted: 0, databaseConfigured: false };
  const { db, storedDocuments } = await import("@workspace/db");
  const { lt } = await import("drizzle-orm");
  const removed = await db.delete(storedDocuments).where(lt(storedDocuments.expiresAt, now)).returning({ id: storedDocuments.id });
  return { deleted: removed.length, databaseConfigured: true };
}

export const TTL_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Starts the scheduled sweep on a fixed interval (default hourly). The sweep
 * callback defaults to `sweepExpiredDocuments` (the lazy-path cleanup).
 * Returns the timer so the host can clear it on shutdown.
 */
export function startTtlSweep(
  sweep: () => Promise<unknown> = sweepExpiredDocuments,
  intervalMs = TTL_SWEEP_INTERVAL_MS,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    sweep().catch(() => {
      // Best-effort background cleanup: never crash the server loop.
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
