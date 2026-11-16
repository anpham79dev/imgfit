#!/usr/bin/env node
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

main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  signal: controller.signal,
  isTTY: Boolean(process.stderr.isTTY),
  readStdin,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`imgfit: lỗi không mong đợi: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 3;
  },
);
