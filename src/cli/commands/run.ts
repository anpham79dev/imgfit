import type { Command } from "commander";
import { run, type RunOptions } from "../../commands/run.js";
import type { CliContext, Opts } from "../context.js";
import { conflictFrom, withProjectOptions } from "../options.js";

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
      .option("-y, --yes", "không hỏi lại khi --adopt", false),
  )
    .addHelpText(
      "after",
      `
Đường dẫn trong imgfit.json tính theo thư mục chứa nó.
Ví dụ:
  imgfit run                       # xử lý phần thay đổi
  imgfit run --dry-run             # xem trước
  imgfit run --adopt --yes         # lần đầu áp vào dự án đã có ảnh`,
    )
    .action(async (o: Opts) => {
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
      await ctx.emit(await run(opts), o);
    });
}
