#!/usr/bin/env node
/**
 * Benchmark cơ sở cho imgfit (docs/plan.md §7.2). Ảnh được TỰ SINH (nhiễu gaussian, khó nén như ảnh thật),
 * không dùng ảnh có bản quyền.
 *
 *   npm run bench                     # mặc định: 200 JPG 2400×2400 → 256×256 cover; 10 PNG 3000×3000 → fit 1024
 *   node scripts/bench.mjs --count 50 --repeat 3 --jobs 1,2,4,8
 *
 * In bảng kết quả + JSON (--json) gồm máy/OS/Node/sharp/libvips, wall clock, peak RSS, bytes.
 */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { resize, versions } from "../dist/index.js";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "200" },
    "png-count": { type: "string", default: "10" },
    repeat: { type: "string", default: "3" },
    jobs: { type: "string", default: "1,2,4,8" },
    dir: { type: "string", default: ".bench" },
    json: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
});

const root = path.resolve(values.dir);
const jobsList = values.jobs.split(",").map(Number);
const repeat = Number(values.repeat);

async function generate(dir, count, w, h, fmt) {
  await mkdir(dir, { recursive: true });
  const existing = (await readdir(dir)).length;
  for (let i = existing; i < count; i++) {
    const img = sharp({ create: { width: w, height: h, channels: fmt === "png" ? 4 : 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } });
    await (fmt === "png" ? img.png({ compressionLevel: 1 }) : img.jpeg({ quality: 92 })).toFile(path.join(dir, `img-${String(i).padStart(4, "0")}.${fmt}`));
  }
}

async function dirBytes(dir) {
  let total = 0;
  for (const f of await readdir(dir)) total += (await stat(path.join(dir, f))).size;
  return total;
}

const workloads = [
  {
    name: `${values.count} JPG 2400×2400 → 256×256 cover jpg q85`,
    src: path.join(root, "jpg"),
    prepare: () => generate(path.join(root, "jpg"), Number(values.count), 2400, 2400, "jpg"),
    opts: { width: 256, height: 256, mode: "cover", format: "jpg" },
  },
  {
    name: `${values["png-count"]} PNG alpha 3000×3000 → fit 1024 png`,
    src: path.join(root, "png"),
    prepare: () => generate(path.join(root, "png"), Number(values["png-count"]), 3000, 3000, "png"),
    opts: { width: 1024, height: 1024, mode: "fit", format: "png" },
  },
];

const results = [];
for (const w of workloads) {
  process.stderr.write(`Chuẩn bị: ${w.name}…\n`);
  await w.prepare();
  const inputBytes = await dirBytes(w.src);
  for (const jobs of jobsList) {
    const runs = [];
    for (let r = 0; r < repeat; r++) {
      const out = path.join(root, "out", `${jobs}-${r}`);
      await rm(out, { recursive: true, force: true });
      const t0 = performance.now();
      const report = await resize({ inputs: [w.src], output: out, jobs, ...w.opts });
      const ms = performance.now() - t0;
      if (report.status !== "ok") throw new Error(`Benchmark lỗi: ${JSON.stringify(report.files.find((f) => f.errors.length)?.errors)}`);
      runs.push({ ms, outputBytes: report.summary.outputBytes });
    }
    const times = runs.map((r) => r.ms).sort((a, b) => a - b);
    results.push({
      workload: w.name,
      jobs,
      runs: repeat,
      medianMs: Math.round(times[Math.floor(times.length / 2)]),
      minMs: Math.round(times[0]),
      maxMs: Math.round(times[times.length - 1]),
      inputBytes,
      outputBytes: runs[0].outputBytes,
    });
    process.stderr.write(`  jobs=${jobs}: median ${(results.at(-1).medianMs / 1000).toFixed(2)}s\n`);
  }
}

const env = {
  ...versions(),
  cpu: os.cpus()[0]?.model ?? "unknown",
  cores: os.cpus().length,
  ramGB: Math.round(os.totalmem() / 1024 ** 3),
  os: `${os.type()} ${os.release()}`,
  uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? "default(4)",
  sharpConcurrency: sharp.concurrency(),
  peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
  note: "Filesystem cache ấm (ảnh vừa được sinh/đọc). Peak RSS là của cả tiến trình benchmark.",
};

if (values.json) {
  process.stdout.write(`${JSON.stringify({ env, results }, null, 2)}\n`);
} else {
  console.log(`\n${env.cpu} · ${env.cores} luồng · ${env.ramGB} GB · ${env.os}`);
  console.log(`node ${env.node} · sharp ${env.sharp} · libvips ${env.libvips} · peak RSS ${env.peakRssMB} MB\n`);
  console.log("| Workload | jobs | median | min–max | input → output |");
  console.log("|---|---|---|---|---|");
  for (const r of results) {
    const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
    console.log(`| ${r.workload} | ${r.jobs} | ${(r.medianMs / 1000).toFixed(2)}s | ${(r.minMs / 1000).toFixed(2)}–${(r.maxMs / 1000).toFixed(2)}s | ${mb(r.inputBytes)} → ${mb(r.outputBytes)} |`);
  }
}

if (!values.keep) await rm(path.join(root, "out"), { recursive: true, force: true });
