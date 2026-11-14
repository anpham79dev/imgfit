import { type Command, Option } from "commander";
import { check, type CheckMode } from "../../commands/check.js";
import type { CliContext, Opts } from "../context.js";
import { withProjectOptions } from "../options.js";

export function registerCheck(program: Command, ctx: CliContext): void {
  withProjectOptions(
    program
      .command("check")
      .description("Kiểm tra output READ-ONLY cho CI/pre-commit (không ghi file, cache hay managed)")
      .argument("[paths...]", "chỉ kiểm tra output/nguồn liên quan (vd. file staged); có imgfit.json trong danh sách → kiểm tra toàn bộ")
      .addOption(
        new Option("--check-mode <mode>", "standard: cần nguồn · output-only: chỉ cần output + imgfit.managed.json · reproducible: encode lại vào temp và so checksum")
          .choices(["standard", "output-only", "reproducible"])
          .default("standard"),
      )
      .option("--strict", "cảnh báo cũng tính là thất bại", false),
  ).action(async (paths: string[], o: Opts) => {
    ctx.banner(o);
    await ctx.emit(await check({ ...ctx.projectOptions(o), mode: o.checkMode as CheckMode, strict: o.strict as boolean, paths }), o);
  });
}
