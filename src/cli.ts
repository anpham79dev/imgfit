import { readFile } from "node:fs/promises";
import { Argument, Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { capabilities, info } from "./commands/info.js";
import { DEFAULT_JOBS, DEFAULT_NAME_TEMPLATE, MAX_JOBS, type ProgressEvent, resize, type ResizeOptions } from "./commands/resize.js";
import { ImgfitError, type Issue, normalizeError } from "./core/errors.js";
import { EXIT, exitCodeFor, exitCodeForError } from "./core/exit.js";
import { parseFormatOption } from "./core/formats.js";
import type { CropPosition, Mode, SmallInputPolicy } from "./core/geometry.js";
import type { OnConflict } from "./core/output.js";
import { RESULT_SCHEMA_VERSION, type Report } from "./core/report.js";
import { TOOL_NAME, TOOL_VERSION, versions } from "./version.js";

export interface CliIO {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  /** Thư mục làm việc (mặc định process.cwd()). */
  cwd?: string;
  signal?: AbortSignal;
  /** stderr có phải terminal không (để quyết định in progress). */
  isTTY?: boolean;
}

// ───────────────────────── parsers ─────────────────────────

function intArg(name: string, min: number, max: number) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new InvalidArgumentError(`${name} phải là số nguyên trong [${min}, ${max}]`);
    return n;
  };
}

function parseSize(value: string): { width: number; height: number } {
  const m = /^\s*(\d+)\s*(?:[x×*]\s*(\d+))?\s*$/i.exec(value);
  if (!m) throw new InvalidArgumentError('dùng dạng WxH (vd. "256x256") hoặc N cho ảnh vuông');
  const width = Number(m[1]);
  const height = Number(m[2] ?? m[1]);
  if (width < 1 || height < 1 || width > 65_535 || height > 65_535) throw new InvalidArgumentError("mỗi chiều phải trong [1, 65535]");
  return { width, height };
}

function parseFocal(value: string): { x: number; y: number } {
  const m = /^\s*([0-9.]+)\s*,\s*([0-9.]+)\s*$/.exec(value);
  const x = Number(m?.[1]);
  const y = Number(m?.[2]);
  if (!m || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new InvalidArgumentError('dùng dạng "x,y" với x, y trong [0,1] (vd. "0.5,0.3")');
  }
  return { x, y };
}

function parseSigma(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.3 || n > 10) throw new InvalidArgumentError("sigma phải trong [0.3, 10]");
  return n;
}

function parseFormat(value: string) {
  try {
    return parseFormatOption(value);
  } catch (err) {
    throw new InvalidArgumentError((err as Error).message);
  }
}

// ───────────────────────── output helpers ─────────────────────────

function formatBytes(n: number | null): string {
  if (n === null) return "unknown";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${(abs / 1024 / 1024).toFixed(2)} MB`;
}

function px(p: [number, number] | null): string {
  return p ? `${p[0]}×${p[1]}` : "?";
}

const STATUS_LABEL: Record<string, string> = {
  planned: "PLAN",
  created: "NEW ",
  replaced: "REPL",
  skipped: "SKIP",
  failed: "FAIL",
  cancelled: "STOP",
};

function printHumanReport(report: Report, io: CliIO, quiet: boolean, verbose: boolean): void {
  const out = (s: string) => io.stdout.write(`${s}\n`);
  for (const f of report.files) {
    const interesting = f.status === "failed" || f.warnings.length > 0;
    if (quiet && f.status !== "failed") continue;
    if (!quiet || interesting) {
      const sizes = `${px(f.inputPx)} → ${px(f.outputPx)}`;
      const bytes = f.status === "skipped" ? "" : `  ${formatBytes(f.inputBytes)} → ${formatBytes(f.outputBytes)}`;
      out(`${STATUS_LABEL[f.status] ?? f.status}  ${f.file} → ${f.destination ?? "?"}  ${sizes}${bytes}`);
    }
    for (const e of f.errors) out(`      ✗ ${e.code}: ${e.message}`);
    if (verbose || !quiet) for (const w of f.warnings) out(`      ! ${w.code}: ${w.message}`);
  }
  for (const e of report.errors) out(`✗ ${e.code}: ${e.message}`);

  const s = report.summary;
  const parts = [
    `${s.total} file`,
    report.dryRun ? `${s.planned} sẽ xử lý` : `${s.created} tạo mới, ${s.replaced} thay thế`,
    `${s.skipped} bỏ qua`,
    `${s.failed} lỗi`,
  ];
  if (s.cancelled) parts.push(`${s.cancelled} đã hủy`);
  if (!report.dryRun && s.processed) parts.push(`tiết kiệm ${formatBytes(s.bytesSaved)}`);
  parts.push(`${(report.elapsedMs / 1000).toFixed(2)}s`);
  out(`\n${report.dryRun ? "[dry-run] " : ""}${report.status.toUpperCase()}: ${parts.join(" · ")}`);
  if (report.status === "aborted") out("Không file nào được ghi vì batch có lỗi trùng đích. Sửa --name hoặc input rồi chạy lại.");
}

function errorDocument(command: string, issues: Issue[]) {
  const v = versions();
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: v.imgfit, sharp: v.sharp, libvips: v.libvips },
    command,
    status: "error" as const,
    errors: issues,
  };
}

// ───────────────────────── main ─────────────────────────

/**
 * Chạy CLI với argv (không gồm "node" và tên script). Trả về exit code, không gọi process.exit
 * để test được in-process và để Node API/khác dùng lại.
 */
export async function main(argv: string[], io: CliIO): Promise<number> {
  const json = argv.includes("--json");
  let exitCode: number = EXIT.OK;
  let currentCommand = argv.find((a) => !a.startsWith("-")) ?? "";

  const fail = (command: string, err: unknown): number => {
    const e = err instanceof ImgfitError ? err : normalizeError(err);
    if (json) io.stdout.write(`${JSON.stringify(errorDocument(command, [e.toIssue()]), null, 2)}\n`);
    else io.stderr.write(`imgfit: ${e.code}: ${e.message}\n`);
    return exitCodeForError(e.code);
  };

  // --version [--json] ở cấp gốc
  if (argv[0] === "--version" || argv[0] === "-V") {
    if (json) io.stdout.write(`${JSON.stringify({ schemaVersion: RESULT_SCHEMA_VERSION, ...versions() }, null, 2)}\n`);
    else io.stdout.write(`${TOOL_VERSION}\n`);
    return EXIT.OK;
  }

  const program = new Command();
  program
    .name("imgfit")
    .description("Tối ưu, chuẩn hóa và kiểm tra asset ảnh trước khi đưa vào repository.")
    .usage("<command> [options]")
    .option("-V, --version", "in version (thêm --json để có version sharp/libvips)")
    .exitOverride()
    .showHelpAfterError("(chạy với --help để xem hướng dẫn)")
    .configureOutput({
      writeOut: (s) => io.stdout.write(s),
      writeErr: (s) => {
        if (!json) io.stderr.write(s);
      },
      outputError: (s, write) => {
        if (!json) write(s);
      },
    });

  program
    .command("resize")
    .description("Resize/chuyển định dạng hàng loạt vào một thư mục output")
    .argument("<inputs...>", "file, thư mục hoặc glob (dùng / kể cả trên Windows; đặt glob trong ngoặc kép)")
    .requiredOption("-s, --size <WxH>", 'kích thước đích, vd. "256x256" hoặc "512" (vuông)', parseSize)
    .requiredOption("-o, --output <dir>", "thư mục output (tương đối theo thư mục hiện tại)")
    .addOption(new Option("-m, --mode <mode>", "fit | cover | pad").choices(["fit", "cover", "pad"]).default("fit"))
    .option("-f, --format <format>", "keep | jpg | png | webp | avif", parseFormat, "keep")
    .option("-q, --quality <1-100>", "chất lượng encoder (mặc định: jpg 85, webp 82, avif 50)", intArg("quality", 1, 100))
    .option("-n, --name <template>", `template tên output; placeholder {name} {ext} {w} {h} {dir}`, DEFAULT_NAME_TEMPLATE)
    .option("-r, --recursive", "quét cả thư mục con khi input là thư mục", false)
    .addOption(new Option("--position <pos>", "điểm crop cho cover").choices(["center", "top", "attention", "focal"]))
    .option("--focal <x,y>", "focal point chuẩn hóa [0,1] trên ảnh đã xoay theo EXIF (ngầm đặt --position focal)", parseFocal)
    .option("--background <hex>", "màu nền cho pad và khi flatten alpha → JPG, vd. #ffffff")
    .addOption(new Option("--small-input <policy>", "khi ảnh nhỏ hơn target: error | keep | pad (mặc định: fit→keep, cover/pad→error)").choices(["error", "keep", "pad"]))
    .option("--upscale", "cho phép phóng to ảnh nhỏ (mặc định tắt)", false)
    .option("--sharpen [sigma]", "sharpen sau khi giảm cỡ (sigma 0.3–10, mặc định 1)", parseSigma)
    .option("--keep-metadata", "giữ EXIF/XMP/ICC (mặc định bỏ, chuyển sRGB)", false)
    .option("--png-palette", "PNG palette (nhỏ hơn, có thể giảm chất lượng)", false)
    .option("--png-compression <0-9>", "mức nén PNG (mặc định 6)", intArg("png-compression", 0, 9))
    .option("-j, --jobs <n>", `số ảnh xử lý song song (1–${MAX_JOBS})`, intArg("jobs", 1, MAX_JOBS), DEFAULT_JOBS)
    .option("--overwrite", "thay output đã tồn tại", false)
    .option("--skip-existing", "bỏ qua nếu output đã tồn tại (KHÔNG kiểm tra output cũ)", false)
    .option("--backup", "sao lưu file cũ trước khi thay (vào .imgfit/backups)", false)
    .option("--backup-dir <dir>", "thư mục backup thay cho .imgfit/backups")
    .option("--max-pixels <n>", "giới hạn số pixel input", intArg("max-pixels", 1, Number.MAX_SAFE_INTEGER))
    .option("--dry-run", "chỉ lập kế hoạch, không ghi file/thư mục nào", false)
    .option("--json", "stdout chỉ chứa JSON report; log ghi stderr", false)
    .option("--quiet", "chỉ in lỗi và tổng kết", false)
    .option("--verbose", "in thêm cảnh báo và thông tin version", false)
    .addHelpText(
      "after",
      `
Đường dẫn tương đối được tính theo thư mục hiện tại.
Ví dụ:
  imgfit resize "raw/**/*.{jpg,png}" --size 256x256 --mode cover --format webp --output out/
  imgfit resize photos/ -r -s 1920x1080 -f jpg -q 80 -o public/img --name "{dir}/{name}.{ext}"
  imgfit resize avatar.png -s 256 -m cover --focal 0.5,0.3 -f jpg -o out --json`,
    )
    .action(async (inputs: string[], o: Record<string, unknown>) => {
      if (o.overwrite && o.skipExisting) throw new ImgfitError("E_USAGE", "Không dùng đồng thời --overwrite và --skip-existing");
      const onConflict: OnConflict = o.overwrite ? "replace" : o.skipExisting ? "skip" : "error";
      const size = o.size as { width: number; height: number };
      const focal = o.focal as { x: number; y: number } | undefined;
      const position = (o.position as CropPosition | undefined) ?? (focal ? "focal" : undefined);
      const opts: ResizeOptions = {
        inputs,
        output: o.output as string,
        width: size.width,
        height: size.height,
        mode: o.mode as Mode,
        format: o.format as ResizeOptions["format"],
        name: o.name as string,
        recursive: o.recursive as boolean,
        jobs: o.jobs as number,
        dryRun: o.dryRun as boolean,
        onConflict,
        backup: o.backup as boolean,
        upscale: o.upscale as boolean,
        stripMetadata: !(o.keepMetadata as boolean),
        ...(io.cwd ? { cwd: io.cwd } : {}),
        ...(io.signal ? { signal: io.signal } : {}),
        ...(o.quality !== undefined ? { quality: o.quality as number } : {}),
        ...(position ? { position } : {}),
        ...(focal ? { focalPoint: focal } : {}),
        ...(o.background ? { background: o.background as string } : {}),
        ...(o.smallInput ? { smallInput: o.smallInput as SmallInputPolicy } : {}),
        ...(o.sharpen !== undefined ? { sharpen: o.sharpen === true ? 1 : (o.sharpen as number) } : {}),
        ...(o.backupDir ? { backupDir: o.backupDir as string } : {}),
        ...(o.maxPixels ? { limitInputPixels: o.maxPixels as number } : {}),
        png: {
          palette: o.pngPalette as boolean,
          ...(o.pngCompression !== undefined ? { compressionLevel: o.pngCompression as number } : {}),
        },
      };

      const showProgress = !json && !o.quiet && io.isTTY === true;
      if (showProgress) {
        opts.onEvent = (e: ProgressEvent) => {
          if (e.type === "done" || e.type === "failed" || e.type === "skipped" || e.type === "cancelled") {
            io.stderr.write(`\r[${e.completed}/${e.total}] ${e.file}`.padEnd(80).slice(0, 120));
            if (e.completed === e.total) io.stderr.write("\n");
          }
        };
      }
      if (o.verbose && !json) {
        const v = versions();
        io.stderr.write(`imgfit ${v.imgfit} · sharp ${v.sharp} · libvips ${v.libvips} · node ${v.node} · ${v.platform}-${v.arch}\n`);
      }

      const report = await resize(opts);
      if (json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else printHumanReport(report, io, o.quiet as boolean, o.verbose as boolean);
      exitCode = exitCodeFor(report);
    });

  program
    .command("info")
    .description("Đọc metadata một ảnh (định dạng thật, kích thước sau EXIF, alpha…), không ghi gì")
    .argument("<file>")
    .option("--json", "in JSON", false)
    .action(async (file: string) => {
      const data = await info(file, io.cwd ? { cwd: io.cwd } : {});
      if (json) {
        io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        return;
      }
      const lines = [
        `file:        ${data.file}`,
        `format:      ${data.format}${data.keepAs ? "" : " (không giữ được với --format keep)"}`,
        `size:        ${data.width}×${data.height}${data.orientation !== 1 ? ` (lưu ${data.storedWidth}×${data.storedHeight}, EXIF orientation ${data.orientation})` : ""}`,
        `alpha:       ${data.hasAlpha ? "có" : "không"}`,
        `colorspace:  ${data.space}${data.hasProfile ? " + ICC profile" : ""}`,
        `bytes:       ${formatBytes(data.bytes)} (${data.bytes})`,
      ];
      io.stdout.write(`${lines.join("\n")}\n`);
    });

  program
    .command("capabilities")
    .description("Liệt kê định dạng/chế độ mà bản build hiện tại hỗ trợ")
    .option("--json", "in JSON", false)
    .action(() => {
      const c = capabilities();
      if (json) {
        io.stdout.write(`${JSON.stringify(c, null, 2)}\n`);
        return;
      }
      const v = c.versions;
      io.stdout.write(
        [
          `imgfit ${v.imgfit} · sharp ${v.sharp} · libvips ${v.libvips} · node ${v.node} · ${v.platform}-${v.arch}`,
          `input:      ${c.input.join(", ")}`,
          `output:     ${c.output.join(", ")}`,
          `modes:      ${c.modes.join(", ")}`,
          `positions:  ${c.positions.join(", ")}`,
        ].join("\n") + "\n",
      );
    });

  program
    .command("schema")
    .description("In JSON Schema để ngôn ngữ khác validate/sinh type")
    .addArgument(new Argument("<kind>", "loại schema").choices(["result", "info"]))
    .action(async (kind: string) => {
      io.stdout.write(await readFile(new URL(`../schema/${kind}.schema.json`, import.meta.url), "utf8"));
    });

  program.hook("preAction", (_this, action) => {
    currentCommand = action.name();
  });

  try {
    if (argv.length === 0) {
      program.outputHelp();
      return EXIT.USAGE;
    }
    await program.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.help" || err.code === "commander.version") return EXIT.OK;
      if (json) io.stdout.write(`${JSON.stringify(errorDocument(currentCommand, [{ code: "E_USAGE", message: err.message.replace(/^error: /, "") }]), null, 2)}\n`);
      return EXIT.USAGE;
    }
    return fail(currentCommand, err);
  }
}
