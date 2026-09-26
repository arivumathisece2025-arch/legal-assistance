import { Router, type IRouter } from "express";
import { appendAuditLog, listAuditLog, verifyAuditChain } from "../lib/auditLog";

const router: IRouter = Router();

/**
 * Reports whether the audit chain is intact.
 *
 * Returns 500 when the chain does not verify, so a monitoring check or a
 * deployment gate fails loudly instead of quietly serving a tampered log.
 */
router.get("/audit/verify", (_req, res): void => {
  const result = verifyAuditChain();
  res.status(result.valid ? 200 : 500).json(result);
});

router.get("/audit", (_req, res): void => {
  res.json({ entries: listAuditLog() });
});

export default router;