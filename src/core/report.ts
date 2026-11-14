import type { Issue } from "./errors.js";
import type { OutputFormat } from "./formats.js";
import { TOOL_NAME, versions } from "../version.js";

/** Version của cấu trúc JSON output. Chỉ tăng khi có thay đổi phá vỡ. */
export const RESULT_SCHEMA_VERSION = 1;

export type FileStatus = "planned" | "created" | "replaced" | "skipped" | "failed" | "cancelled";
export type RunStatus = "ok" | "failed" | "aborted" | "cancelled";

export interface FileResult {
  /** Đường dẫn input (posix, tương đối theo cwd nếu nằm trong cwd). */
  file: string;
  /** Đường dẫn output (posix, cùng quy ước), null nếu chưa xác định được. */
  destination: string | null;
  status: FileStatus;
  preset: string | null;
  format: OutputFormat | null;
  inputBytes: number | null;
  /** null = chưa biết (dry-run, lỗi, hoặc skip). */
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
  processed: number;
  created: number;
  replaced: number;
  planned: number;
  skipped: number;
  failed: number;
  cancelled: number;
  inputBytes: number;
  outputBytes: number;
  /** Tổng (inputBytes - outputBytes) trên các file đã ghi. Có thể âm. */
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
  /** Lỗi cấp batch (vd. collision làm dừng toàn bộ trước khi ghi). */
  errors: Issue[];
}

export function summarize(files: FileResult[]): Summary {
  const s: Summary = {
    total: files.length,
    processed: 0,
    created: 0,
    replaced: 0,
    planned: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
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

export function makeReport(command: string, startedAt: Date, dryRun: boolean, files: FileResult[], errors: Issue[], cancelled: boolean): Report {
  const summary = summarize(files);
  let status: RunStatus = "ok";
  if (errors.length > 0) status = "aborted";
  else if (cancelled) status = "cancelled";
  else if (summary.failed > 0) status = "failed";
  const v = versions();
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: v.imgfit, sharp: v.sharp, libvips: v.libvips },
    command,
    status,
    dryRun,
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    summary,
    files,
    errors,
  };
}
