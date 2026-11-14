#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { main } from "./cli/index.js";

const controller = new AbortController();
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130); // second Ctrl+C: exit immediately
  interrupted = true;
  controller.abort();
  process.stderr.write("\nĐang hủy: không bắt đầu ảnh mới, chờ ảnh đang xử lý xong (Ctrl+C lần nữa để thoát ngay)…\n");
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Only prompt when both stdin and stderr are terminals; otherwise the CLI requires --yes. */
const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY);
async function confirm(destinations: string[]): Promise<boolean> {
  const preview = destinations.slice(0, 20).map((d) => `  ${d}`);
  if (destinations.length > 20) preview.push(`  … và ${destinations.length - 20} file khác`);
  process.stderr.write(`Sẽ adopt ${destinations.length} output có sẵn (không sửa ảnh, chỉ ghi vào imgfit.managed.json):\n${preview.join("\n")}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question("Tiếp tục? [y/N] ");
    return /^(y|yes|c|có|co)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  signal: controller.signal,
  isTTY: Boolean(process.stderr.isTTY),
  readStdin,
  ...(interactive ? { confirm } : {}),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`imgfit: lỗi không mong đợi: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 3;
  },
);
