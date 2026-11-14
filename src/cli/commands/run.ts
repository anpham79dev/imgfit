import type { Command } from "commander";
import { run, type RunOptions } from "../../commands/run.js";
import { watch } from "../../commands/watch.js";
import { ImgfitError } from "../../core/errors.js";
import { EXIT, exitCodeFor } from "../../core/exit.js";
import { printHumanReport } from "../format.js";
import type { CliContext, Opts } from "../context.js";
import { conflictFrom, withProjectOptions } from "../options.js";

/** `run --watch`: prints one report per run; the exit code is the worst seen (cancellation ignored). */
async function runWatch(ctx: CliContext, opts: RunOptions, o: Opts): Promise<void> {
  if (!ctx.json) ctx.io.stderr.write("Đang theo dõi thay đổi (Ctrl+C để dừng)…\n");
  let worst: number = EXIT.OK;
  await watch({
    ...opts,
    onReport: (report, trigger) => {
      if (ctx.json) ctx.writeJson({ trigger, ...report }, false);
      else {
        ctx.line(`\n— ${new Date().toLocaleTimeString()} (${trigger}) —`);
        printHumanReport(report, (s) => ctx.line(s), o.quiet as boolean, o.verbose as boolean);
      }
      const code = exitCodeFor(report);
      worst = Math.max(worst, code === EXIT.CANCELLED ? EXIT.OK : code);
    },
    onError: (err) => {
      ctx.fail(err);
    },
  });
  ctx.exitCode = worst;
}

export function registerRun(program: Command, ctx: CliContext): void {
  withProjectOptions(
    program
      .command("run")
      .description("Áp rules trong imgfit.json (incremental: chỉ xử lý nguồn/preset/output đã đổi)")
      .option("--dry-run", "chỉ báo sẽ làm gì (create/replace/unchanged), không ghi gì", false)
      .option("--overwrite", "thay cả output chưa được quản lý hoặc đã bị sửa tay", false)
      .option("--skip-existing", "bỏ qua output có sẵn chưa được quản lý (KHÔNG kiểm tra)", false)
      .option("--backup", "sao lưu output cũ trước khi thay (vào .imgfit/backups)", false)
      .option("--adopt", "nhận output đã có sẵn ở đúng đích rule vào imgfit.managed.json (không encode)", false)
      .option("-y, --yes", "không hỏi lại khi --adopt", false)
      .option("-w, --watch", "chạy rồi theo dõi thay đổi nguồn/config và chạy lại phần đổi", false),
  )
    .addHelpText(
      "after",
      `
Đường dẫn trong imgfit.json tính theo thư mục chứa nó.
Ví dụ:
  imgfit run                       # xử lý phần thay đổi
  imgfit run --dry-run             # xem trước
  imgfit run --adopt --yes         # lần đầu áp vào dự án đã có ảnh
  imgfit run --watch               # tự chạy lại khi nguồn đổi`,
    )
    .action(async (o: Opts) => {
      if (o.watch && (o.adopt || o.dryRun)) throw new ImgfitError("E_USAGE", "--watch không dùng chung với --adopt / --dry-run");
      const onConflict = conflictFrom(o);
      const opts: RunOptions = {
        ...ctx.projectOptions(o),
        ...(onConflict ? { onConflict } : {}),
        dryRun: o.dryRun as boolean,
        backup: o.backup as boolean,
        adopt: o.adopt as boolean,
        yes: o.yes as boolean,
        ...(ctx.io.confirm ? { confirm: ctx.io.confirm } : {}),
      };
      const onEvent = ctx.progress(o);
      if (onEvent) opts.onEvent = onEvent;
      ctx.banner(o);
      if (o.watch) await runWatch(ctx, opts, o);
      else await ctx.emit(await run(opts), o);
    });
}
