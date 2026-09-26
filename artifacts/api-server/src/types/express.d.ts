import type { SessionData } from "../middlewares/session";

declare global {
  namespace Express {
    interface Request {
      /** Present after `sessionMiddleware` has run. */
      session?: SessionData;
    }
  }
}

export {};