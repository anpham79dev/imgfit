import type { Response } from "express";
import type { ProgressEvent } from "../pipeline/batch.js";
import { type Issue, normalizeError } from "../core/errors.js";
import type { Report } from "../core/report.js";
import { newId } from "./sessions.js";

export type BatchStatus = "running" | "done" | "error";

export interface BatchOutput {
  index: number;
  /** name inside the ZIP / download (relative posix path) */
  name: string;
  file: string;
}

export interface Batch {
  id: string;
  kind: "quick" | "project";
  sessionId?: string;
  status: BatchStatus;
  createdAt: number;
  controller: AbortController;
  events: Array<{ id: number; event: string; data: unknown }>;
  listeners: Set<Response>;
  report?: Report;
  error?: Issue;
  outputs: BatchOutput[];
  /** original request, kept to retry failed files */
  request?: unknown;
}

const MAX_EVENTS = 20_000;
const KEEP_MS = 2 * 60 * 60 * 1000;

/** Background batches + SSE (event ids allow reconnecting with Last-Event-ID). */
export class BatchStore {
  readonly batches = new Map<string, Batch>();

  start(kind: Batch["kind"], work: (b: Batch, onEvent: (e: ProgressEvent) => void) => Promise<Report>, extra: Partial<Batch> = {}): Batch {
    this.gc();
    const b: Batch = {
      id: newId(),
      kind,
      status: "running",
      createdAt: Date.now(),
      controller: new AbortController(),
      events: [],
      listeners: new Set(),
      outputs: [],
      ...extra,
    };
    this.batches.set(b.id, b);
    const onEvent = (e: ProgressEvent) => {
      const { result, ...rest } = e;
      this.push(b, "progress", {
        ...rest,
        ...(result ? { status: result.status, errors: result.errors, warnings: result.warnings, outputBytes: result.outputBytes, outputPx: result.outputPx } : {}),
      });
    };
    void work(b, onEvent).then(
      (report) => {
        b.report = report;
        b.status = "done";
        this.push(b, "done", { status: report.status, summary: report.summary, errors: report.errors });
        this.end(b);
      },
      (err: unknown) => {
        b.error = normalizeError(err).toIssue();
        b.status = "error";
        this.push(b, "error", { errors: [b.error] });
        this.end(b);
      },
    );
    return b;
  }

  get(id: string): Batch | undefined {
    return this.batches.get(id);
  }

  private push(b: Batch, event: string, data: unknown): void {
    const ev = { id: b.events.length + 1, event, data };
    if (b.events.length < MAX_EVENTS || event !== "progress") b.events.push(ev);
    for (const res of b.listeners) writeEvent(res, ev);
  }

  private end(b: Batch): void {
    for (const res of b.listeners) res.end();
    b.listeners.clear();
  }

  /** Attaches an SSE connection and replays events after `lastEventId`. */
  subscribe(b: Batch, res: Response, lastEventId: number): void {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("retry: 2000\n\n");
    for (const ev of b.events) if (ev.id > lastEventId) writeEvent(res, ev);
    if (b.status !== "running") {
      res.end();
      return;
    }
    b.listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    res.on("close", () => {
      clearInterval(ping);
      b.listeners.delete(res);
    });
  }

  cancelAll(): void {
    for (const b of this.batches.values()) b.controller.abort();
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, b] of this.batches) if (b.status !== "running" && now - b.createdAt > KEEP_MS) this.batches.delete(id);
  }
}

function writeEvent(res: Response, ev: { id: number; event: string; data: unknown }): void {
  res.write(`id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
}
