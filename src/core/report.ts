import type { OutputFormat } from "../image/formats.js";
import { TOOL_NAME, versions } from "../version.js";
import type { Issue } from "./errors.js";

/** Version of the JSON output structure. Only bumped on breaking changes. */
export const RESULT_SCHEMA_VERSION = 1;

/**
 * - planned: dry-run, will be processed (see `action`)
 * - created / replaced: written
 * - unchanged: `run` found source + preset + output unchanged → not re-encoded
 * - adopted: `run --adopt` took an existing output under management
 * - skipped: intentionally skipped (--skip-existing)
 * - failed / cancelled
 * - pass / warn / fail: results of `check`
 */
export type FileStatus = "planned" | "created" | "replaced" | "unchanged" | "adopted" | "skipped" | "failed" | "cancelled" | "pass" | "warn" | "fail";
export type RunStatus = "ok" | "failed" | "aborted" | "cancelled";
export type FileAction = "create" | "replace" | "adopt" | null;

export interface FileResult {
  /** Input path (posix, relative to the command's base directory when inside it). */
  file: string;
  /** Output path (same convention), null when it could not be determined. */
  destination: string | null;
  status: FileStatus;
  /** What will be / was done to the output (most useful for dry-runs). */
  action: FileAction;
  rule: string | null;
  preset: string | null;
  format: OutputFormat | null;
  inputBytes: number | null;
  /** null = unknown (dry-run, error or skip). */
  outputBytes: number | null;
  inputPx: [number, number] | null;
  outputPx: [number, number] | null;
  elapsedMs: number;
  fingerprint: string | null;
  warnings: Issue[];
  errors: Issue[];
}

export interface Summary {
  total: number;
  /** created + replaced */
  processed: number;
  created: number;
  replaced: number;
  unchanged: number;
  adopted: number;
  planned: number;
  skipped: number;
  failed: number;
  cancelled: number;
  pass: number;
  warn: number;
  fail: number;
  inputBytes: number;
  outputBytes: number;
  /** Sum of (inputBytes - outputBytes) over written files. May be negative. */
  bytesSaved: number;
}

export interface Report {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  tool: { name: string; version: string; sharp: string; libvips: string };
  command: string;
  status: RunStatus;
  dryRun: boolean;
  startedAt: string;
  elapsedMs: number;
  summary: Summary;
  files: FileResult[];
  /** Batch-level errors (e.g. a collision that aborted everything before writing). */
  errors: Issue[];
  /** Batch-level warnings (orphaned outputs, stale lock, version mismatch…). */
  warnings: Issue[];
}

export function newFileResult(file: string, init: Partial<FileResult> = {}): FileResult {
  return {
    file,
    destination: null,
    status: "planned",
    action: null,
    rule: null,
    preset: null,
    format: null,
    inputBytes: null,
    outputBytes: null,
    inputPx: null,
    outputPx: null,
    elapsedMs: 0,
    fingerprint: null,
    warnings: [],
    errors: [],
    ...init,
  };
}

export function summarize(files: FileResult[]): Summary {
  const s: Summary = {
    total: files.length,
    processed: 0,
    created: 0,
    replaced: 0,
    unchanged: 0,
    adopted: 0,
    planned: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
    pass: 0,
    warn: 0,
    fail: 0,
    inputBytes: 0,
    outputBytes: 0,
    bytesSaved: 0,
  };
  for (const f of files) {
    s[f.status] += 1;
    if (f.status === "created" || f.status === "replaced") {
      s.processed += 1;
      s.inputBytes += f.inputBytes ?? 0;
      s.outputBytes += f.outputBytes ?? 0;
    }
  }
  s.bytesSaved = s.inputBytes - s.outputBytes;
  return s;
}

export interface ReportInput {
  command: string;
  startedAt: Date;
  dryRun: boolean;
  files: FileResult[];
  errors?: Issue[];
  warnings?: Issue[];
  cancelled?: boolean;
}

export function makeReport(input: ReportInput): Report {
  const files = input.files;
  const errors = input.errors ?? [];
  const summary = summarize(files);
  let status: RunStatus = "ok";
  if (errors.length > 0) status = "aborted";
  else if (input.cancelled) status = "cancelled";
  else if (summary.failed > 0 || summary.fail > 0) status = "failed";
  const v = versions();
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: v.imgfit, sharp: v.sharp, libvips: v.libvips },
    command: input.command,
    status,
    dryRun: input.dryRun,
    startedAt: input.startedAt.toISOString(),
    elapsedMs: Date.now() - input.startedAt.getTime(),
    summary,
    files,
    errors,
    warnings: input.warnings ?? [],
  };
}
