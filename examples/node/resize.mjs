// Node: dùng API import trực tiếp (cùng core với CLI).
//   node examples/node/resize.mjs <thư-mục-ảnh> <thư-mục-output>
import { resize } from "imgfit";

const [input = "raw", output = "out"] = process.argv.slice(2);

const report = await resize({
  inputs: [input],
  output,
  width: 256,
  height: 256,
  mode: "cover",
  format: "webp",
  recursive: true,
  name: "{dir}/{name}.{ext}",
});

for (const f of report.files) {
  const err = f.errors[0];
  console.log(`${f.status.padEnd(9)} ${f.file} -> ${f.destination ?? "?"}${err ? `  [${err.code}] ${err.message}` : ""}`);
}
console.log(`status=${report.status} created=${report.summary.created} failed=${report.summary.failed}`);
process.exitCode = report.status === "ok" ? 0 : 1;
