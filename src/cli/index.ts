import { Command, CommanderError } from "commander";
import { EXIT } from "../core/exit.js";
import { RESULT_SCHEMA_VERSION } from "../core/report.js";
import { TOOL_VERSION, versions } from "../version.js";
import { registerExec } from "./commands/exec.js";
import { registerInit } from "./commands/init.js";
import { registerInspect } from "./commands/inspect.js";
import { registerResize } from "./commands/resize.js";
import { registerUi } from "./commands/ui.js";
import { CliContext, type CliIO } from "./context.js";
import { errorDocument } from "./format.js";

export type { CliIO } from "./context.js";

function buildProgram(ctx: CliContext): Command {
  const program = new Command();
  program
    .name("imgfit")
    .description("Engine xử lý ảnh: resize, chuyển định dạng, watermark. Gọi được từ mọi ngôn ngữ qua CLI + JSON.")
    .usage("<command> [options]")
    .option("-V, --version", "in version (thêm --json để có version sharp/libvips)")
    .exitOverride()
    .showHelpAfterError("(chạy với --help để xem hướng dẫn)")
    .configureOutput({
      writeOut: (s) => ctx.io.stdout.write(s),
      // with --json, stdout must stay pure JSON and errors are reported as an ErrorDocument instead
      writeErr: (s) => {
        if (!ctx.json) ctx.io.stderr.write(s);
      },
      outputError: (s, write) => {
        if (!ctx.json) write(s);
      },
    });

  registerResize(program, ctx);
  registerInit(program, ctx);
  registerExec(program, ctx);
  registerInspect(program, ctx);
  registerUi(program, ctx);

  program.hook("preAction", (_this, action) => {
    ctx.command = action.name();
  });
  return program;
}

/**
 * Runs the CLI with argv (without "node" and the script name). Returns the exit code instead of calling
 * process.exit, so it can be tested in-process and embedded.
 */
export async function main(argv: string[], io: CliIO): Promise<number> {
  // exec is machine-facing: its stdout is always JSON (NDJSON), errors included
  const ctx = new CliContext(io, argv.includes("--json") || argv[0] === "exec", argv);

  if (argv[0] === "--version" || argv[0] === "-V") {
    if (ctx.json) ctx.writeJson({ schemaVersion: RESULT_SCHEMA_VERSION, ...versions() });
    else ctx.line(TOOL_VERSION);
    return EXIT.OK;
  }

  const program = buildProgram(ctx);
  if (argv.length === 0) {
    program.outputHelp();
    return EXIT.USAGE;
  }
  try {
    await program.parseAsync(argv, { from: "user" });
    return ctx.exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.help" || err.code === "commander.version") return EXIT.OK;
      if (ctx.json) ctx.writeJson(errorDocument(ctx.command, [{ code: "E_USAGE", message: err.message.replace(/^error: /, "") }]));
      return EXIT.USAGE;
    }
    return ctx.fail(err);
  }
}
