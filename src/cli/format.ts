/**
 * Human-readable output and report files. Machine output (--json) is written verbatim by the context.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Issue } from "../core/errors.js";
import { type FileResult, RESULT_SCHEMA_VERSION, type Report } from "../core/report.js";
import { TOOL_NAME, versions } from "../version.js";

export function formatBytes(n: number | null): string {
  if (n === null) return "unknown";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${(abs / 1024 / 1024).toFixed(2)} MB`;
}

export const px = (p: [number, number] | null): string => (p ? `${p[0]}×${p[1]}` : "?");

const STATUS_LABEL: Record<string, string> = {
  planned: "PLAN",
  created: "NEW ",
  replaced: "REPL",
  unchanged: "SAME",
  adopted: "ADOP",
  skipped: "SKIP",
  failed: "FAIL",
  cancelled: "STOP",
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
};

function fileLine(f: FileResult, dryRun: boolean, isCheck: boolean): string {
  const action = dryRun && f.action ? ` [${f.action}]` : "";
  const sizes = isCheck ? px(f.outputPx) : `${px(f.inputPx)} → ${px(f.outputPx)}`;
  const bytes =
    f.status === "skipped" || f.status === "adopted" ? "" : isCheck ? `  ${formatBytes(f.outputBytes)}` : `  ${formatBytes(f.inputBytes)} → ${formatBytes(f.outputBytes)}`;
  return `${STATUS_LABEL[f.status] ?? f.status}${action}  ${f.file} → ${f.destination ?? "?"}  ${sizes}${bytes}`;
}

function summaryLine(report: Report): string {
  const s = report.summary;
  const parts =
    report.command === "check"
      ? [`${s.total} output`, `${s.pass} pass`, `${s.warn} warn`, `${s.fail} fail`]
      : [
          `${s.total} file`,
          report.dryRun ? `${s.planned} sẽ xử lý` : `${s.created} tạo mới, ${s.replaced} thay thế`,
          ...(s.unchanged ? [`${s.unchanged} không đổi`] : []),
          ...(s.adopted ? [`${s.adopted} adopt`] : []),
          `${s.skipped} bỏ qua`,
          `${s.failed} lỗi`,
        ];
  if (s.cancelled) parts.push(`${s.cancelled} đã hủy`);
  if (!report.dryRun && s.processed) parts.push(`tiết kiệm ${formatBytes(s.bytesSaved)}`);
  parts.push(`${(report.elapsedMs / 1000).toFixed(2)}s`);
  return `${report.dryRun ? "[dry-run] " : ""}${report.status.toUpperCase()}: ${parts.join(" · ")}`;
}

/** One line per interesting file, its issues, then a summary. `unchanged`/`pass` lines only with --verbose. */
export function printHumanReport(report: Report, write: (line: string) => void, quiet: boolean, verbose: boolean): void {
  const isCheck = report.command === "check";
  for (const f of report.files) {
    const bad = f.status === "failed" || f.status === "fail";
    const interesting = bad || f.warnings.length > 0;
    if (quiet && !bad) continue;
    if ((f.status === "unchanged" || f.status === "pass") && !verbose && !interesting) continue;
    if (!quiet || interesting) write(fileLine(f, report.dryRun, isCheck));
    for (const e of f.errors) write(`      ✗ ${e.code}: ${e.message}`);
    if (verbose || !quiet) for (const w of f.warnings) write(`      ! ${w.code}: ${w.message}`);
  }
  for (const e of report.errors) write(`✗ ${e.code}: ${e.message}`);
  if (!quiet) for (const w of report.warnings) write(`! ${w.code}: ${w.message}`);
  write(`\n${summaryLine(report)}`);
  if (report.status === "aborted") write("Không file nào được ghi vì batch có lỗi trùng đích. Sửa --name hoặc input rồi chạy lại.");
}

/** JSON emitted on stdout when a command fails before producing a report (see result.schema.json). */
export function errorDocument(command: string, issues: Issue[]) {
  const v = versions();
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: v.imgfit, sharp: v.sharp, libvips: v.libvips },
    command,
    status: "error" as const,
    errors: issues,
  };
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

export const writeReportJson = (file: string, report: unknown) => writeText(file, `${JSON.stringify(report, null, 2)}\n`);
