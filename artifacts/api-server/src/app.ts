import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { rateLimit } from "./middlewares/rateLimit";
import { securityHeaders } from "./middlewares/securityHeaders";
import { sessionMiddleware } from "./middlewares/session";

const app: Express = express();

// Behind a proxy, req.ip must come from X-Forwarded-For or every client
// shares one rate-limit bucket.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders);
/**
 * CORS allow-list.
 *
 * `CORS_ORIGIN` may be a single origin or a comma-separated list, e.g.
 * `https://clause-compass.vercel.app,https://clause-compass-abc.vercel.app`
 * Do NOT include a trailing slash.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://clause-compass-g2fs2nu4d-4rivxs-projects.vercel.app",
];

// Vercel preview deployments get a unique URL per deployment
// (e.g. https://clause-compass-abc123-4rivxs-projects.vercel.app).
// Allow any Clause-Compass Vercel deployment so previews keep working.
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/clause-compass.*\.vercel\.app$/;

const envOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins])];

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin / curl / health checks / Render rewrites have no Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (VERCEL_PREVIEW_ORIGIN.test(origin)) return callback(null, true);
      // In local dev with no CORS_ORIGIN configured, reflect any localhost origin.
      if (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sessionMiddleware);
app.use("/api", rateLimit({ limit: 300, intervalMs: 60_000 }), router);

export default app;
