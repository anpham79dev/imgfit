import { type Command, Option } from "commander";
import { init } from "../../commands/init.js";
import type { Profile } from "../../project/config/types.js";
import type { CliContext, Opts } from "../context.js";

export function registerInit(program: Command, ctx: CliContext): void {
  program
    .command("init")
    .description("Tạo imgfit.json mẫu + imgfit.schema.json và thêm .imgfit/ vào .gitignore")
    .addOption(new Option("-p, --profile <profile>", "bộ mặc định").choices(["generic", "web", "unity"]).default("generic"))
    .option("--force", "ghi đè imgfit.json / imgfit.schema.json đã có", false)
    .option("--json", "in JSON", false)
    .action(async (o: Opts) => {
      const r = await init({ ...(ctx.io.cwd ? { cwd: ctx.io.cwd } : {}), profile: o.profile as Profile, force: o.force as boolean });
      if (ctx.json) {
        ctx.writeJson(r);
        return;
      }
      for (const f of r.files) ctx.line(`${f.status.padEnd(11)} ${f.path}`);
      if (r.files.some((f) => f.status === "skipped")) ctx.line("\nCó file đã tồn tại nên được giữ nguyên; dùng --force để ghi đè.");
      ctx.line("\nTiếp theo: đặt ảnh nguồn vào thư mục roots.input trong imgfit.json, rồi chạy: imgfit run --dry-run");
    });
}
