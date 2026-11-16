import { spawn } from "node:child_process";
import type { Command } from "commander";
import type { CliContext, Opts } from "../context.js";
import { intArg } from "../parsers.js";

/** Opens a URL in the default browser; arguments are passed as an array, never through a shell string. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    // if it cannot be opened the user opens the printed URL manually
  }
}

export function registerUi(program: Command, ctx: CliContext): void {
  program
    .command("ui")
    .description("Mở web UI chạy cục bộ (chỉ 127.0.0.1): kéo thả ảnh, resize, tải về")
    .option("--root <dir>", "thư mục có imgfit.json (preset hiện trong UI)", ".")
    .option("--port <n>", "cổng (0 = ngẫu nhiên)", intArg("port", 0, 65_535), 8765)
    .option("--open", "tự mở trình duyệt", false)
    .action(async (o: Opts) => {
      // loaded lazily so the other commands do not pay for express/multer
      const { startUiServer } = await import("../../server/app.js");
      const server = await startUiServer({ root: ctx.resolve(o.root as string), port: o.port as number });
      ctx.io.stderr.write(`imgfit ui đang chạy (chỉ máy này truy cập được).\nMở: ${server.url}\nURL chứa token dùng một lần — đừng chia sẻ. Ctrl+C để dừng.\n`);
      if (o.open) openBrowser(server.url);
      const signal = ctx.io.signal;
      await new Promise<void>((resolve) => {
        if (!signal) return; // embedding without a signal: keep serving
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await server.close();
    });
}
