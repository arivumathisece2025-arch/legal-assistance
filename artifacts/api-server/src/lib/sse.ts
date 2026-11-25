import type { Request, Response } from "express";

export function isSseRequest(req: Pick<Request, "headers" | "query">): boolean {
  return req.headers.accept?.includes("text/event-stream") === true || req.query.stream === "sse";
}

export function openSse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  sendSseEvent(res, "status", { step: "retrieving" });
}

export function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function closeSse(res: Response): void {
  if (!res.destroyed && !res.writableEnded) res.end();
}