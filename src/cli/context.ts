import path from "node:path";
import { ImgfitError, normalizeError } from "../core/errors.js";
import { EXIT, exitCodeFor, exitCodeForError } from "../core/exit.js";
import type { Report } from "../core/report.js";
import type { ProgressEvent } from "../pipeline/batch.js";
import { versions } from "../version.js";
import { errorDocument, printHumanReport, writeReportJson } from "./format.js";

export interface CliIO {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  /** Working directory (default process.cwd()). */
  cwd?: string;
  signal?: AbortSignal;
  /** Whether stderr is a terminal (progress is only drawn on a TTY). */
  isTTY?: boolean;
  /** Reads all of stdin (for `exec --stdin`). */
  readStdin?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

/** Parsed commander options of one command. */
export type Opts = Record<string, unknown>;

/** Per-invocation state shared by every command registration. */
export class CliContext {
  exitCode: number = EXIT.OK;
  command: string;

  constructor(
    readonly io: CliIO,
    /** --json anywhere on the command line: stdout carries JSON only */
    readonly json: boolean,
    argv: string[],
  ) {
    this.command = argv.find((a) => !a.startsWith("-")) ?? "";
  }

  get cwd(): string {
    return this.io.cwd ?? process.cwd();
  }

  resolve(p: string): string {
    return path.resolve(this.cwd, p);
  }

  line(text: string): void {
    this.io.stdout.write(`${text}\n`);
  }

  writeJson(data: unknown, pretty = true): void {
    this.io.stdout.write(`${pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)}\n`);
  }

  /** Reports an error that happened before/outside a report; returns the exit code. */
  fail(err: unknown): number {
    const e = err instanceof ImgfitError ? err : normalizeError(err);
    if (this.json) this.writeJson(errorDocument(this.command, [e.toIssue()]));
    else this.io.stderr.write(`imgfit: ${e.code}: ${e.message}\n`);
    return exitCodeForError(e.code);
  }

  /** Prints a report (JSON or human), writes requested report files and records the exit code. */
  async emit(report: Report, o: Opts): Promise<void> {
    if (this.json) this.writeJson(report);
    else printHumanReport(report, (s) => this.line(s), o.quiet as boolean, o.verbose as boolean);
    if (o.reportJson) await writeReportJson(this.resolve(o.reportJson as string), report);
    this.exitCode = exitCodeFor(report);
  }

  /** Single-line progress on stderr, only for humans on a TTY. */
  progress(o: Opts): ((e: ProgressEvent) => void) | undefined {
    if (this.json || o.quiet || this.io.isTTY !== true) return undefined;
    return (e) => {
      if (e.type === "queued" || e.type === "processing") return;
      this.io.stderr.write(`\r[${e.completed}/${e.total}] ${e.file}`.padEnd(80).slice(0, 120));
      if (e.completed === e.total) this.io.stderr.write("\n");
    };
  }

  /** Version banner on stderr with --verbose. */
  banner(o: Opts): void {
    if (!o.verbose || this.json) return;
    const v = versions();
    this.io.stderr.write(`imgfit ${v.imgfit} · sharp ${v.sharp} · libvips ${v.libvips} · node ${v.node} · ${v.platform}-${v.arch}\n`);
  }
}
