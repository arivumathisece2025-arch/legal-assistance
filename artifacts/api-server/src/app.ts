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
app.use(cors({ origin: process.env.CORS_ORIGIN ?? true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sessionMiddleware);
app.use("/api", rateLimit({ limit: 300, intervalMs: 60_000 }), router);

export default app;
