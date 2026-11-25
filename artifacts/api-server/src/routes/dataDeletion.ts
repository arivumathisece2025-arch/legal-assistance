import { Router, type IRouter } from "express";
import { appendAuditLog } from "../lib/auditLog";
import { createLogger, hashIdentifier } from "../lib/secureLogger";
import { csrfProtection } from "../middlewares/csrf";
import { rateLimit } from "../middlewares/rateLimit";
import { purgeDocumentsFor } from "./documents";

const logger = createLogger("delete-data");

const router: IRouter = Router();

type PurgeOutcome = {
  documentsPurged: number;
  databaseRowsDeleted: number | null;
  databaseConfigured: boolean;
};

/**
 * DPDP Act 2023 erasure endpoint.
 *
 * Deletes only the caller's in-memory documents and DB rows where the id
 * belongs to that caller (scoped by owner_id). Public documents are never
 * deleted here.
 *
 * App-wide CSRF protection guards every state-changing API route; this route
 * also has a tighter rate limit because it can remove caller data.
 */
router.post("/data/delete", rateLimit({ limit: 5, intervalMs: 60_000 }), csrfProtection, async (req, res): Promise<void> => {
  const userId = req.session!.userId;

  const purgedIds = purgeDocumentsFor(userId);

  let databaseRowsDeleted: number | null = null;
  let databaseConfigured = false;

  if (process.env.DATABASE_URL) {
    databaseConfigured = true;
    try {
      const { eq } = await import("drizzle-orm");
      const { db, storedDocuments } = await import("@workspace/db");
      const deleted = await db.delete(storedDocuments).where(eq(storedDocuments.ownerId, userId)).returning({ id: storedDocuments.id });
      databaseRowsDeleted = deleted.length;
    } catch (error) {
      logger.error("Database purge failed", { reason: error instanceof Error ? error.message : "unknown" });
      res.status(500).json({ error: "Data deletion failed while clearing the database." });
      return;
    }
  }

  // Audit rows are deliberately NOT deleted: an append-only record of the
  // erasure request must outlive the data it describes.
  appendAuditLog("DATA_DELETION_REQUEST", userId, {
    documentsPurged: purgedIds.length,
    databaseRowsDeleted,
    databaseConfigured,
  });

  logger.info("User data deleted", {
    userIdHash: hashIdentifier(userId),
    documentsPurged: purgedIds.length,
    databaseRowsDeleted,
  });

  res.json({
    message: "Data purged",
    documentsPurged: purgedIds.length,
    databaseRowsDeleted,
    databaseConfigured,
  } satisfies PurgeOutcome & { message: string });
});

export default router;