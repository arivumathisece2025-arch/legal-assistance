import app from "./app";
import { logger } from "./lib/logger";
import { validateEncryptionKey } from "./lib/keys";
import { readPersistedAuditEntries } from "./lib/auditStore";
import { loadAuditChain, verifyAuditChain } from "./lib/auditLog";
import { startTtlSweep, sweepExpiredDocuments } from "./lib/ttlSweep";
import { sweepExpiredMemoryDocuments } from "./routes/documents";

validateEncryptionKey();

if (process.env.DATABASE_URL) {
  try {
    const persistedEntries = await readPersistedAuditEntries();
    loadAuditChain(persistedEntries);
    const verification = verifyAuditChain();
    if (!verification.valid) {
      logger.error({ length: verification.length, tamperedIndex: verification.tamperedIndex }, "Persisted audit chain failed verification");
    }
  } catch (error) {
    logger.error({ err: error }, "Unable to initialize the persisted audit chain");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startTtlSweep(async () => {
    const now = new Date();
    sweepExpiredMemoryDocuments(now);
    await sweepExpiredDocuments(now);
  });
});
