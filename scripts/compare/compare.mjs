#!/usr/bin/env node
/**
 * Runs the sample set (scripts/samples.mjs) through Intervention Image v2 (GD, typical hand-written code),
 * imgproxy and imgfit with the same presets, then measures every output: size, box, bytes, metadata,
 * progressive, transparent background and PSNR against an exact lanczos3 reference of the same size.
 * Intervention and imgproxy run in Docker, only for this comparison.
 *
 *   npm run build && node scripts/compare/compare.mjs [--work <dir>] [--no-huge] [--json <file>]
 *
 * Writes <work>/results.json; scripts/compare/report.mjs prints it as Markdown tables.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { resize, versions } from "../../dist/index.js";
import { makeSamples } from "../samples.mjs";

sharp.cache({ files: 0 });

const { values } = parseArgs({
  options: {
    work: { type: "string", default: path.join(os.tmpdir(), "imgfit-compare") },
    "no-huge": { type: "boolean", default: false },
    json: { type: "string" },
    port: { type: "string", default: "18080" },
  },
});
const IMGPROXY = "darthsim/imgproxy:v3.30.1";
const IV_IMAGE = "imgfit-compare-intervention";
const work = path.resolve(values.work);
const samplesDir = path.join(work, "samples");
const PRESETS = { L: [640, 480], LL: [1600, 1200] };

const log = (s) => process.stderr.write(`${s}\n`);
function docker(args, opts = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`docker ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}

// ── tools ──

/** Each tool returns [{ sample, preset, variant, out, ms, error? }]. */
async function runIntervention(samples) {
  log("→ build image Intervention");
  docker(["build", "-q", "-t", IV_IMAGE, path.join(import.meta.dirname, "intervention")]);
  const variants = [
    { variant: "q100", quality: 100 }, // the "quality 100" habit
    { variant: "q90-default", quality: undefined }, // Intervention v2 default (90)
    { variant: "q80", quality: 80 },
    { variant: "q80-no-enlarge", quality: 80, noEnlarge: true },
  ];
  const jobs = [];
  for (const s of samples) {
    for (const [preset, [w, h]] of Object.entries(PRESETS)) {
      for (const v of variants) {
        const rel = `out/intervention/${v.variant}/${preset}/${path.parse(s.name).name}.jpg`;
        await mkdir(path.dirname(path.join(work, rel)), { recursive: true });
        jobs.push({ sample: s.name, preset, variant: v.variant, rel, in: `/work/samples/${s.name}`, out: `/work/${rel}`, w, h, ...(v.quality ? { quality: v.quality } : {}), noEnlarge: !!v.noEnlarge });
      }
    }
  }
  await writeFile(path.join(work, "iv-jobs.json"), JSON.stringify(jobs));
  log(`→ Intervention: ${jobs.length} job`);
  const out = docker(["run", "--rm", "-v", `${work}:/work`, IV_IMAGE, "/work/iv-jobs.json"]);
  const byOut = new Map(
    out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((r) => [r.out, r]),
  );
  return jobs.map((j) => {
    const r = byOut.get(j.out) ?? { error: "không có kết quả" };
    return { tool: "intervention", sample: j.sample, preset: j.preset, variant: j.variant, out: path.join(work, j.rel), ms: r.ms ?? null, error: r.error };
  });
}

async function runImgproxy(samples) {
  log("→ khởi động imgproxy");
  const name = `imgfit-compare-imgproxy-${process.pid}`;
  docker(["run", "-d", "--rm", "--name", name, "-p", `127.0.0.1:${values.port}:8080`, "-v", `${samplesDir}:/images:ro`, "-e", "IMGPROXY_LOCAL_FILESYSTEM_ROOT=/images", "-e", "IMGPROXY_MAX_SRC_RESOLUTION=60", IMGPROXY]);
  const base = `http://127.0.0.1:${values.port}`;
  try {
    for (let i = 0; i < 100; i++) {
      if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const version = IMGPROXY;
    const variants = [
      { variant: "q80", path: (w, h) => `rs:fit:${w}:${h}:0/q:80` },
      { variant: "webp-default", path: (w, h) => `rs:fit:${w}:${h}:0`, ext: "webp" },
    ];
    const results = [];
    for (const s of samples) {
      for (const [preset, [w, h]] of Object.entries(PRESETS)) {
        for (const v of variants) {
          const ext = v.ext ?? "jpg";
          const out = path.join(work, "out", "imgproxy", v.variant, preset, `${path.parse(s.name).name}.${ext}`);
          await mkdir(path.dirname(out), { recursive: true });
          const url = `${base}/insecure/${v.path(w, h)}/plain/local:///${encodeURIComponent(s.name)}@${ext}`;
          const t0 = performance.now();
          const res = await fetch(url);
          const buf = Buffer.from(await res.arrayBuffer());
          const ms = Math.round(performance.now() - t0);
          if (!res.ok) {
            results.push({ tool: "imgproxy", sample: s.name, preset, variant: v.variant, out, ms, error: `HTTP ${res.status} ${buf.toString("utf8").slice(0, 200)}` });
            continue;
          }
          await writeFile(out, buf);
          results.push({ tool: "imgproxy", sample: s.name, preset, variant: v.variant, out, ms });
        }
      }
    }
    return { results, version };
  } finally {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
}

async function runImgfit(samples) {
  const variants = [
    { variant: "jpg-q80", format: "jpg", quality: 80 },
    { variant: "jpg-q85", format: "jpg", quality: 85 },
    { variant: "webp-default", format: "webp" },
    { variant: "avif-default", format: "avif" },
  ];
  const results = [];
  for (const v of variants) {
    for (const [preset, [w, h]] of Object.entries(PRESETS)) {
      const outDir = path.join(work, "out", "imgfit", v.variant, preset);
      await rm(outDir, { recursive: true, force: true });
      log(`→ imgfit ${v.variant} ${preset}`);
      const r = await resize({
        inputs: samples.map((s) => s.file),
        output: outDir,
        width: w,
        height: h,
        mode: "fit",
        format: v.format,
        ...(v.quality ? { quality: v.quality } : {}),
        jobs: 1, // per-image timing without parallelism (same as the other tools)
        limitInputPixels: 100_000_000,
      });
      for (const f of r.files) {
        const sample = path.basename(f.file);
        results.push({
          tool: "imgfit",
          sample,
          preset,
          variant: v.variant,
          out: f.destination ? path.resolve(f.destination) : null,
          ms: f.elapsedMs,
          error: f.errors[0] ? `${f.errors[0].code}: ${f.errors[0].message}` : undefined,
        });
      }
    }
  }
  return results;
}

/** Wall-clock of one `imgfit resize` CLI call (process start + sharp load + one image). */
function cliLatency(sample, runs = 5) {
  const bin = path.join(import.meta.dirname, "..", "..", "dist", "bin.js");
  const times = [];
  for (let i = 0; i < runs; i++) {
    const out = path.join(work, "out", "cli", String(i));
    const t0 = performance.now();
    const r = spawnSync(process.execPath, [bin, "resize", sample, "-s", "640x480", "-f", "jpg", "-q", "80", "-o", out, "--overwrite", "--json"], { encoding: "utf8" });
    times.push(performance.now() - t0);
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  }
  times.sort((a, b) => a - b);
  return { medianMs: Math.round(times[Math.floor(runs / 2)]), minMs: Math.round(times[0]), maxMs: Math.round(times.at(-1)) };
}

// ── measurements ──

/** GPS IFD pointer tag (0x8825) in either byte order. */
const exifHasGps = (exif) => !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])));

async function psnr(src, out, w, h) {
  const flat = (img) => img.flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const ref = await flat(sharp(await readFile(src), { limitInputPixels: false }).autoOrient().resize(w, h, { fit: "fill", kernel: "lanczos3" }));
  const got = await flat(sharp(await readFile(out)));
  if (ref.length !== got.length) return null;
  let se = 0;
  for (let i = 0; i < ref.length; i++) se += (ref[i] - got[i]) ** 2;
  const mse = se / ref.length;
  return mse === 0 ? 99 : Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100;
}

async function measure(r, srcMeta) {
  if (r.error || !r.out) return r;
  const buf = await readFile(r.out);
  const m = await sharp(buf).metadata();
  const [W, H] = PRESETS[r.preset];
  const src = srcMeta.get(r.sample);
  const corner = await sharp(buf).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  return {
    ...r,
    bytes: buf.length,
    w: m.width,
    h: m.height,
    format: m.format,
    inBox: m.width <= W && m.height <= H,
    enlarged: m.width > src.w || m.height > src.h,
    progressive: !!m.isProgressive,
    exif: !!m.exif,
    gps: exifHasGps(m.exif),
    icc: !!m.icc,
    space: m.space,
    corner: `${corner[0]},${corner[1]},${corner[2]},${corner[3]}`,
    psnr: await psnr(path.join(samplesDir, r.sample), r.out, m.width, m.height),
  };
}

// ── main ──

await mkdir(samplesDir, { recursive: true });
log(`Thư mục làm việc: ${work}`);
const samples = await makeSamples(samplesDir, { huge: !values["no-huge"] });
const srcMeta = new Map();
for (const s of samples) {
  const m = await sharp(s.file, { limitInputPixels: false }).metadata();
  const o = (m.orientation ?? 1) >= 5;
  srcMeta.set(s.name, { w: o ? m.height : m.width, h: o ? m.width : m.height, bytes: (await stat(s.file)).size, format: m.format });
}

const iv = await runIntervention(samples);
const ip = await runImgproxy(samples);
const fit = await runImgfit(samples);
log("→ đo output");
const rows = [];
for (const r of [...iv, ...ip.results, ...fit]) rows.push(await measure(r, srcMeta));
log("→ đo độ trễ CLI");
const cli = cliLatency(path.join(samplesDir, "landscape-3000x2000.jpg"));

const doc = {
  generatedAt: new Date().toISOString(),
  env: { ...versions(), imgproxy: ip.version, intervention: "intervention/image 2.7.2 (GD, PHP 8.3)", cpu: os.cpus()[0]?.model, os: `${os.type()} ${os.release()}` },
  presets: PRESETS,
  samples: Object.fromEntries([...srcMeta].map(([k, v]) => [k, { ...v, why: samples.find((s) => s.name === k)?.why }])),
  cliLatency: cli,
  rows: rows.map(({ out, ...r }) => ({ ...r, out: out ? path.relative(work, out).split(path.sep).join("/") : null })),
};
await writeFile(path.join(work, "results.json"), `${JSON.stringify(doc, null, 2)}\n`);
if (values.json) await writeFile(values.json, `${JSON.stringify(doc, null, 2)}\n`);
log(`✓ ${rows.length} output → ${path.join(work, "results.json")}`);
