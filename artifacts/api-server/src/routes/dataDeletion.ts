import { Router, type IRouter } from "express";
import { appendAuditLog } from "../lib/auditLog";
import { createLogger, hashIdentifier } from "../lib/secureLogger";
import { csrfProtection } from "../middlewares/csrf";
import { rateLimit } from "../middlewares/rateLimit";
import { purgeAllDocuments } from "./documents";

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
 * Scope note: `stored_documents` has no owner column, so there is no way to
 * delete one user's rows. Until the schema carries a user identifier this
 * endpoint can only offer a full wipe, which is why it is POST-only, audited,
 * and reports exactly what it removed rather than a blanket success message.
 *
 * CSRF and a tight rate limit are attached here rather than app-wide: this is
 * the only route that destroys data, and a global CSRF check would reject the
 * existing document/question endpoints, which send no CSRF header.
 */
router.post("/data/delete", rateLimit({ limit: 5, intervalMs: 60_000 }), csrfProtection, async (req, res): Promise<void> => {
  const userId = req.session?.userId ?? "anonymous";

  const purgedIds = purgeAllDocuments();

  let databaseRowsDeleted: number | null = null;
  let databaseConfigured = false;

  if (process.env.DATABASE_URL) {
    databaseConfigured = true;
    try {
      const { eq } = await import("drizzle-orm");
      const { db, storedDocuments } = await import("@workspace/db");
      const target = typeof req.body?.documentId === "string" ? req.body.documentId : undefined;
      const deleted = target
        ? await db.delete(storedDocuments).where(eq(storedDocuments.id, target)).returning({ id: storedDocuments.id })
        : await db.delete(storedDocuments).returning({ id: storedDocuments.id });
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