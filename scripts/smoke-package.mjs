#!/usr/bin/env node
/**
 * Package smoke test as a real user would: npm pack → install the .tgz into an empty project → use CLI + Node API.
 *   node scripts/smoke-package.mjs        (run npm run build first)
 * Exits non-zero if any step fails.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const win = process.platform === "win32";
const tmp = await mkdtemp(path.join(os.tmpdir(), "imgfit-smoke-"));

function run(cmd, args, cwd, { allow = [0] } = {}) {
  // on Windows npm/npx are .cmd files → run through cmd.exe /c; arguments are script constants.
  const [c, a] = win && (cmd === "npm" || cmd === "npx") ? ["cmd.exe", ["/d", "/s", "/c", cmd, ...args]] : [cmd, args];
  const r = spawnSync(c, a, { cwd, encoding: "utf8" });
  if (!allow.includes(r.status)) {
    console.error(`✗ ${cmd} ${args.join(" ")} (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r;
}
const step = (s) => console.error(`→ ${s}`);

try {
  step("npm pack");
  run("npm", ["pack", "--pack-destination", tmp], root);
  const tgz = (await readdir(tmp)).find((f) => f.endsWith(".tgz"));
  const proj = path.join(tmp, "consumer");
  await mkdir(path.join(proj, "images-src", "photos"), { recursive: true });
  await writeFile(path.join(proj, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));

  step(`npm install ${tgz}`);
  run("npm", ["install", "--no-audit", "--no-fund", path.join(tmp, tgz)], proj);

  step("CLI: --version / capabilities");
  const v = JSON.parse(run("npx", ["imgfit", "--version", "--json"], proj).stdout);
  if (!v.imgfit || !v.libvips) throw new Error("version JSON thiếu trường");
  JSON.parse(run("npx", ["imgfit", "capabilities", "--json"], proj).stdout);

  step("Node API + ảnh mẫu");
  await writeFile(
    path.join(proj, "make.mjs"),
    `import sharp from "sharp";
     await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#468" } }).jpeg().toFile("images-src/photos/a.jpg");
     const { resize, capabilities } = await import("imgfit");
     const r = await resize({ inputs: ["images-src/photos"], output: "api-out", width: 64, height: 64, mode: "cover", format: "webp" });
     if (r.status !== "ok" || r.summary.created !== 1) { console.error(JSON.stringify(r, null, 2)); process.exit(1); }
     console.log(capabilities().output.join(","));`,
  );
  run("node", ["make.mjs"], proj);

  step("CLI: init → exec với preset");
  run("npx", ["imgfit", "init"], proj);
  await writeFile(path.join(proj, "job.json"), JSON.stringify({ schemaVersion: 1, jobs: [{ input: "images-src/photos/a.jpg", output: "out/L_a.jpg", preset: "L" }] }));
  const lines = run("npx", ["imgfit", "exec", "--file", "job.json"], proj).stdout.trim().split("\n").map((l) => JSON.parse(l));
  const summary = lines.at(-1);
  if (summary.type !== "summary" || summary.status !== "ok" || summary.summary.created !== 1) throw new Error(`exec: ${JSON.stringify(summary)}`);
  run("npx", ["imgfit", "exec", "--file", "nope.json"], proj, { allow: [2] });

  console.error(`✓ smoke OK (imgfit ${v.imgfit}, sharp ${v.sharp}, ${process.platform}-${process.arch})`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
