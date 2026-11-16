#!/usr/bin/env node
/**
 * Prints the Markdown tables of docs/behavior.md from a compare.mjs results.json.
 *   node scripts/compare/report.mjs [results.json]
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const file = process.argv[2] ?? path.join(os.tmpdir(), "imgfit-compare", "results.json");
const d = JSON.parse(await readFile(file, "utf8"));
const ok = d.rows.filter((r) => !r.error);
const kb = (b) => `${Math.round(b / 1024).toLocaleString("vi-VN")} KB`;

console.log(`Môi trường: ${d.env.cpu} · ${d.env.os} · node ${d.env.node} · sharp ${d.env.sharp} · libvips ${d.env.libvips} · ${d.env.intervention} · ${d.env.imgproxy}\n`);

console.log("| Công cụ | Biến thể | Preset | Ảnh | Tổng dung lượng | PSNR TB (dB) | ms/ảnh TB | Vượt khung | Phóng to | Còn GPS | Lỗi |");
console.log("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
const groups = new Map();
for (const r of d.rows) {
  const k = `${r.tool}|${r.variant}|${r.preset}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
for (const [k, rs] of [...groups].sort()) {
  const [tool, variant, preset] = k.split("|");
  const g = rs.filter((r) => !r.error);
  const sum = (f) => g.reduce((a, r) => a + (f(r) ?? 0), 0);
  console.log(
    `| ${tool} | ${variant} | ${preset} | ${g.length} | ${kb(sum((r) => r.bytes))} | ${(sum((r) => r.psnr) / g.length).toFixed(2)} | ${Math.round(sum((r) => r.ms) / g.length)} | ${g.filter((r) => !r.inBox).length} | ${g.filter((r) => r.enlarged).length} | ${g.filter((r) => r.gps).length} | ${rs.length - g.length} |`,
  );
}

const pick = (sample, preset, keys) =>
  keys.map(([tool, variant]) => ok.find((r) => r.sample === sample && r.preset === preset && r.tool === tool && r.variant === variant)).filter(Boolean);
const cases = [
  ["near-square-2000x1900.jpg", "LL"],
  ["small-300x200.jpg", "LL"],
  ["transparent-1200x800.png", "L"],
  ["cmyk-2400x1600.jpg", "L"],
  ["precompressed-640x480-q55.jpg", "L"],
];
const tools = [
  ["intervention", "q100"],
  ["intervention", "q80"],
  ["imgproxy", "q80"],
  ["imgfit", "jpg-q80"],
];
console.log("\n| Ảnh | Preset | Công cụ | Output | Dung lượng | PSNR | Góc (RGBA) |");
console.log("|---|---|---|---|---:|---:|---|");
for (const [sample, preset] of cases) {
  const src = d.samples[sample];
  for (const r of pick(sample, preset, tools)) {
    console.log(`| ${sample} (${src.w}×${src.h}, ${kb(src.bytes)}) | ${preset} | ${r.tool} ${r.variant} | ${r.w}×${r.h}${r.inBox ? "" : " **vượt khung**"}${r.enlarged ? " **phóng to**" : ""} | ${kb(r.bytes)} | ${r.psnr} | ${r.corner} |`);
  }
}
console.log(`\nĐộ trễ một lần gọi CLI (resize 1 ảnh 3000×2000 → 640×480): median ${d.cliLatency.medianMs} ms (min ${d.cliLatency.minMs}, max ${d.cliLatency.maxMs}).`);
const errs = d.rows.filter((r) => r.error);
if (errs.length) {
  console.log("\nLỗi:");
  for (const e of new Map(errs.map((e) => [`${e.tool}|${e.sample}`, e])).values()) console.log(`- ${e.tool} · ${e.sample}: ${e.error}`);
}
