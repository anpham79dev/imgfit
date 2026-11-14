import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { exec, parseExecSpec } from "../../commands/exec.js";
import { ImgfitError } from "../../core/errors.js";
import { exitCodeFor } from "../../core/exit.js";
import type { CliContext, Opts } from "../context.js";
import { writeReportJson } from "../format.js";

async function readSpecText(ctx: CliContext, o: Opts): Promise<string> {
  if (Boolean(o.stdin) === Boolean(o.file)) throw new ImgfitError("E_USAGE", "Chọn đúng một nguồn job: --stdin hoặc --file <job.json>");
  if (o.stdin) {
    if (!ctx.io.readStdin) throw new ImgfitError("E_USAGE", "Không đọc được stdin trong môi trường này");
    return ctx.io.readStdin();
  }
  return readFile(ctx.resolve(o.file as string), "utf8").catch((e: unknown) => {
    throw new ImgfitError("E_INPUT_NOT_FOUND", `Không đọc được ${o.file}: ${(e as Error).message}`);
  });
}

/** stdout is NDJSON: one JSON object per line — progress, result (FileResult) and a final summary. */
export function registerExec(program: Command, ctx: CliContext): void {
  program
    .command("exec")
    .description("Chạy danh sách job JSON (từ stdin hoặc file), in NDJSON: progress / result / summary")
    .option("--stdin", "đọc job từ stdin", false)
    .option("--file <job.json>", "đọc job từ file")
    .option("--report-json <file>", "ghi thêm JSON report đầy đủ ra file")
    .addHelpText(
      "after",
      `
Job (schema: imgfit schema job):
  {"schemaVersion":1,"jobs":[{"input":"a.jpg","output":"out/a.webp","size":[256,256],"mode":"cover","format":"webp"}]}
Mỗi dòng stdout là một JSON: {"type":"progress",…} | {"type":"result",…} | {"type":"summary",…}.`,
    )
    .action(async (o: Opts) => {
      const spec = await parseExecSpec(await readSpecText(ctx, o));
      const line = (obj: unknown) => ctx.writeJson(obj, false);
      const report = await exec(spec, {
        ...(ctx.io.cwd ? { cwd: ctx.io.cwd } : {}),
        ...(ctx.io.signal ? { signal: ctx.io.signal } : {}),
        onEvent: (e) => {
          if (e.result) line({ type: "result", ...e.result });
          else line({ type: "progress", event: e.type, file: e.file, destination: e.destination, completed: e.completed, total: e.total });
        },
      });
      // no per-file events are emitted for dry-runs or aborted batches, so list results here
      if (report.dryRun || report.status === "aborted") for (const f of report.files) line({ type: "result", ...f });
      const { files: _files, ...summary } = report;
      line({ type: "summary", ...summary });
      if (o.reportJson) await writeReportJson(ctx.resolve(o.reportJson as string), report);
      ctx.exitCode = exitCodeFor(report);
    });
}
