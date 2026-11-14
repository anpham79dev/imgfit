/**
 * Read-only commands: info, capabilities, schema.
 */
import { readFile } from "node:fs/promises";
import { Argument, type Command } from "commander";
import { capabilities, info } from "../../commands/info.js";
import type { CliContext } from "../context.js";
import { formatBytes } from "../format.js";

export const SCHEMA_KINDS = ["config", "result", "info", "job"] as const;

export function registerInspect(program: Command, ctx: CliContext): void {
  program
    .command("info")
    .description("Đọc metadata một ảnh (định dạng thật, kích thước sau EXIF, alpha…), không ghi gì")
    .argument("<file>")
    .option("--json", "in JSON", false)
    .action(async (file: string) => {
      const d = await info(file, ctx.io.cwd ? { cwd: ctx.io.cwd } : {});
      if (ctx.json) {
        ctx.writeJson(d);
        return;
      }
      const rotated = d.orientation !== 1 ? ` (lưu ${d.storedWidth}×${d.storedHeight}, EXIF orientation ${d.orientation})` : "";
      ctx.line(
        [
          `file:        ${d.file}`,
          `format:      ${d.format}${d.keepAs ? "" : " (không giữ được với --format keep)"}`,
          `size:        ${d.width}×${d.height}${rotated}`,
          `alpha:       ${d.hasAlpha ? "có" : "không"}`,
          `colorspace:  ${d.space}${d.hasProfile ? " + ICC profile" : ""}`,
          `bytes:       ${formatBytes(d.bytes)} (${d.bytes})`,
        ].join("\n"),
      );
    });

  program
    .command("capabilities")
    .description("Liệt kê định dạng/chế độ mà bản build hiện tại hỗ trợ")
    .option("--json", "in JSON", false)
    .action(() => {
      const c = capabilities();
      if (ctx.json) {
        ctx.writeJson(c);
        return;
      }
      const v = c.versions;
      ctx.line(
        [
          `imgfit ${v.imgfit} · sharp ${v.sharp} · libvips ${v.libvips} · node ${v.node} · ${v.platform}-${v.arch}`,
          `input:      ${c.input.join(", ")}`,
          `output:     ${c.output.join(", ")}`,
          `modes:      ${c.modes.join(", ")}`,
          `positions:  ${c.positions.join(", ")}`,
        ].join("\n"),
      );
    });

  program
    .command("schema")
    .description("In JSON Schema để ngôn ngữ khác validate/sinh type")
    .addArgument(new Argument("<kind>", "loại schema").choices([...SCHEMA_KINDS]))
    .action(async (kind: string) => {
      ctx.io.stdout.write(await readFile(new URL(`../../../schema/${kind}.schema.json`, import.meta.url), "utf8"));
    });
}
