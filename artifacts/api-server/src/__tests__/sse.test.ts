import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { closeSse, isSseRequest, openSse, sendSseEvent } from "../lib/sse";

test("isSseRequest recognizes the event-stream header and query flag", () => {
  assert.equal(isSseRequest({ headers: { accept: "text/event-stream" }, query: {} } as Request), true);
  assert.equal(isSseRequest({ headers: {}, query: { stream: "sse" } } as unknown as Request), true);
  assert.equal(isSseRequest({ headers: { accept: "application/json" }, query: {} } as Request), false);
});

test("SSE helpers set response headers, format events, and close once", () => {
  const headers = new Map<string, string>();
  const chunks: string[] = [];
  let flushed = false;
  let ended = false;
  const response = {
    destroyed: false,
    get writableEnded() { return ended; },
    setHeader(name: string, value: string) { headers.set(name, value); return this; },
    flushHeaders() { flushed = true; },
    write(chunk: string) { chunks.push(chunk); return true; },
    end() { ended = true; return this; },
  } as unknown as Response;

  openSse(response);
  sendSseEvent(response, "token", { token: "hello" });
  closeSse(response);

  assert.equal(headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.equal(headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(headers.get("Connection"), "keep-alive");
  assert.equal(flushed, true);
  assert.deepEqual(chunks, [
    'event: status\ndata: {"step":"retrieving"}\n\n',
    'event: token\ndata: {"token":"hello"}\n\n',
  ]);
  assert.equal(ended, true);
  closeSse(response);
  assert.equal(ended, true);
});