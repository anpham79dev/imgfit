import { type Command, Option } from "commander";
import { DEFAULT_JOBS, DEFAULT_NAME_TEMPLATE, MAX_JOBS, resize, type ResizeOptions } from "../../commands/resize.js";
import { ImgfitError } from "../../core/errors.js";
import type { FormatOption, OutputFormat } from "../../image/formats.js";
import type { CropPosition, Mode, SmallInputPolicy } from "../../image/geometry.js";
import type { CliContext, Opts } from "../context.js";
import { conflictFrom, withOutputOptions } from "../options.js";
import { intArg, parseFocal, parseFormat, parseFormatList, parseSigma, parseSize } from "../parsers.js";

/** `--keep png,webp --format jpg`: --format is the fallback and must be a concrete format. */
function keepFallback(format: FormatOption): OutputFormat {
  if (format === "keep" || typeof format === "object") throw new ImgfitError("E_USAGE", "--keep cần --format <jpg|png|webp|avif> làm định dạng fallback");
  return format;
}

/** Maps parsed CLI options to the Node API options (pure; easy to test). */
export function toResizeOptions(inputs: string[], o: Opts, ctx: CliContext): ResizeOptions {
  const size = o.size as { width: number; height: number };
  const focal = o.focal as { x: number; y: number } | undefined;
  const position = (o.position as CropPosition | undefined) ?? (focal ? "focal" : undefined);
  return {
    inputs,
    output: o.output as string,
    width: size.width,
    height: size.height,
    mode: o.mode as Mode,
    format: o.keep ? { keep: o.keep as OutputFormat[], fallback: keepFallback(o.format as FormatOption) } : (o.format as FormatOption),
    name: o.name as string,
    recursive: o.recursive as boolean,
    jobs: o.jobs as number,
    dryRun: o.dryRun as boolean,
    onConflict: conflictFrom(o) ?? "error",
    backup: o.backup as boolean,
    upscale: o.upscale as boolean,
    stripMetadata: !(o.keepMetadata as boolean),
    ...(ctx.io.cwd ? { cwd: ctx.io.cwd } : {}),
    ...(ctx.io.signal ? { signal: ctx.io.signal } : {}),
    ...(o.quality !== undefined ? { quality: o.quality as number } : {}),
    ...(position ? { position } : {}),
    ...(focal ? { focalPoint: focal } : {}),
    ...(o.background ? { background: o.background as string } : {}),
    ...(o.smallInput ? { smallInput: o.smallInput as SmallInputPolicy } : {}),
    // `--sharpen` without a value means sigma 1
    ...(o.sharpen !== undefined ? { sharpen: o.sharpen === true ? 1 : (o.sharpen as number) } : {}),
    ...(o.backupDir ? { backupDir: o.backupDir as string } : {}),
    ...(o.maxPixels ? { limitInputPixels: o.maxPixels as number } : {}),
    jpeg: { progressive: o.progressive as boolean },
    keepSmallerSource: o.keepSmallerSource as boolean,
    png: {
      palette: o.pngPalette as boolean,
      ...(o.pngCompression !== undefined ? { compressionLevel: o.pngCompression as number } : {}),
    },
  };
}

export function registerResize(program: Command, ctx: CliContext): void {
  const cmd = program
    .command("resize")
    .description("Resize/chuyển định dạng hàng loạt vào một thư mục output")
    .argument("<inputs...>", "file, thư mục hoặc glob (dùng / kể cả trên Windows; đặt glob trong ngoặc kép)")
    .requiredOption("-s, --size <WxH>", 'kích thước đích, vd. "256x256" hoặc "512" (vuông)', parseSize)
    .requiredOption("-o, --output <dir>", "thư mục output (tương đối theo thư mục hiện tại)")
    .addOption(new Option("-m, --mode <mode>", "fit | cover | pad").choices(["fit", "cover", "pad"]).default("fit"))
    .option("-f, --format <format>", "keep | jpg | png | webp | avif", parseFormat, "keep")
    .option("--keep <formats>", "giữ định dạng input nếu nằm trong danh sách (vd. png,webp), ngược lại dùng --format", parseFormatList)
    .option("-q, --quality <1-100>", "chất lượng encoder (mặc định: jpg 80, webp 82, avif 50)", intArg("quality", 1, 100))
    .option("-n, --name <template>", `template tên output; placeholder {name} {ext} {w} {h} {dir}`, DEFAULT_NAME_TEMPLATE)
    .option("-r, --recursive", "quét cả thư mục con khi input là thư mục", false)
    .addOption(new Option("--position <pos>", "điểm crop cho cover").choices(["center", "top", "attention", "focal"]))
    .option("--focal <x,y>", "focal point chuẩn hóa [0,1] trên ảnh đã xoay theo EXIF (ngầm đặt --position focal)", parseFocal)
    .option("--background <hex>", "màu nền cho pad và khi flatten alpha → JPG, vd. #ffffff")
    .addOption(new Option("--small-input <policy>", "khi ảnh nhỏ hơn target: error | keep | pad | skip (mặc định: fit→keep, cover/pad→error)").choices(["error", "keep", "pad", "skip"]))
    .option("--upscale", "cho phép phóng to ảnh nhỏ (mặc định tắt)", false)
    .option("--sharpen [sigma]", "sharpen sau khi giảm cỡ (sigma 0.3–10, mặc định 1)", parseSigma)
    .option("--keep-metadata", "giữ EXIF/XMP/ICC (mặc định bỏ, chuyển sRGB)", false)
    .option("--no-progressive", "JPEG baseline thay vì progressive (mặc định progressive)")
    .option("--no-keep-smaller-source", "luôn ghi bản encode, kể cả khi nặng hơn ảnh gốc cùng định dạng/kích thước")
    .option("--png-palette", "PNG palette (nhỏ hơn, có thể giảm chất lượng)", false)
    .option("--png-compression <0-9>", "mức nén PNG (mặc định 6)", intArg("png-compression", 0, 9))
    .option("-j, --jobs <n>", `số ảnh xử lý song song (1–${MAX_JOBS})`, intArg("jobs", 1, MAX_JOBS), DEFAULT_JOBS)
    .option("--overwrite", "thay output đã tồn tại", false)
    .option("--skip-existing", "bỏ qua nếu output đã tồn tại (KHÔNG kiểm tra output cũ)", false)
    .option("--backup", "sao lưu file cũ trước khi thay (vào .imgfit/backups)", false)
    .option("--backup-dir <dir>", "thư mục backup thay cho .imgfit/backups")
    .option("--max-pixels <n>", "giới hạn số pixel input", intArg("max-pixels", 1, Number.MAX_SAFE_INTEGER))
    .option("--dry-run", "chỉ lập kế hoạch, không ghi file/thư mục nào", false);

  withOutputOptions(cmd)
    .addHelpText(
      "after",
      `
Đường dẫn tương đối được tính theo thư mục hiện tại.
Ví dụ:
  imgfit resize "raw/**/*.{jpg,png}" --size 256x256 --mode cover --format webp --output out/
  imgfit resize photos/ -r -s 1920x1080 -f jpg -q 80 -o public/img --name "{dir}/{name}.{ext}"
  imgfit resize avatar.png -s 256 -m cover --focal 0.5,0.3 -f jpg -o out --json`,
    )
    .action(async (inputs: string[], o: Opts) => {
      const opts = toResizeOptions(inputs, o, ctx);
      const onEvent = ctx.progress(o);
      if (onEvent) opts.onEvent = onEvent;
      ctx.banner(o);
      await ctx.emit(await resize(opts), o);
    });
}
