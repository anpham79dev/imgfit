#!/usr/bin/env node
/**
 * Builds a PORTABLE bundle for the current platform: runs on machines WITHOUT Node installed.
 *
 *   node scripts/build-portable.mjs            # build + bundle + smoke test
 *   node scripts/build-portable.mjs --sea      # also a single executable (Node SEA) — see the Windows note
 *   node scripts/build-portable.mjs --skip-build
 *
 * Output: release/imgfit-<version>-<platform>-<arch>/ plus a .zip (Windows) / .tar.gz (others).
 *
 *   node(.exe)          the original Node binary, signature intact (accepted by Windows Smart App Control)
 *   app/                dist + schema + production node_modules (sharp/libvips for this platform)
 *   imgfit.cmd          Windows launcher (cmd)       imgfit.ps1  PowerShell launcher
 *   imgfit              sh launcher (Linux/macOS)
 *   imgfit(.exe)        [--sea] single executable; on Windows it MUST be code-signed or Smart App Control blocks it
 *
 * Calling from other languages without a shell: [<bundle>/node(.exe), <bundle>/app/dist/bin.js, ...args]
 * Other platforms: run this script on that platform (CI matrix), because sharp downloads per-OS/CPU binaries.
 */
import { spawnSync } from "node:child_process";
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { sea: { type: "boolean", default: false }, "skip-build": { type: "boolean", default: false }, out: { type: "string", default: "release" } } });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const win = process.platform === "win32";
const name = `imgfit-${pkg.version}-${process.platform}-${process.arch}`;
const outRoot = path.resolve(root, values.out);
const out = path.join(outRoot, name);
const app = path.join(out, "app");

function sh(cmd, args, cwd = root) {
  // on Windows npm is npm.cmd → run through cmd.exe /c; arguments are constants, never user data.
  const [c, a] = win && cmd === "npm" ? ["cmd.exe", ["/d", "/s", "/c", "npm", ...args]] : [cmd, args];
  const r = spawnSync(c, a, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → exit ${r.status}`);
}

console.error(`→ ${name}`);
if (!values["skip-build"]) sh("npm", ["run", "build"]);

await rm(out, { recursive: true, force: true });
await mkdir(app, { recursive: true });
for (const p of ["dist", "schema"]) await cp(path.join(root, p), path.join(app, p), { recursive: true });
for (const f of ["package.json", "package-lock.json", "README.md"]) await copyFile(path.join(root, f), path.join(app, f));
// production dependencies only; sharp fetches the libvips binary for this OS/CPU
sh("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts=false"], app);

const nodeName = win ? "node.exe" : "node";
await copyFile(process.execPath, path.join(out, nodeName));
await writeFile(path.join(out, "imgfit.cmd"), '@echo off\r\n"%~dp0node.exe" "%~dp0app\\dist\\bin.js" %*\r\n');
await writeFile(path.join(out, "imgfit.ps1"), '& "$PSScriptRoot\\node.exe" "$PSScriptRoot\\app\\dist\\bin.js" @args\r\nexit $LASTEXITCODE\r\n');
await writeFile(path.join(out, "imgfit"), '#!/bin/sh\nDIR="$(cd "$(dirname "$0")" && pwd)"\nexec "$DIR/node" "$DIR/app/dist/bin.js" "$@"\n');
if (!win) {
  await chmod(path.join(out, "imgfit"), 0o755);
  await chmod(path.join(out, nodeName), 0o755);
}

if (values.sea) {
  const seaDir = path.join(outRoot, `.sea-${name}`);
  await rm(seaDir, { recursive: true, force: true });
  await mkdir(seaDir, { recursive: true });
  await writeFile(
    path.join(seaDir, "main.cjs"),
    [
      'const path = require("node:path");',
      'const { pathToFileURL } = require("node:url");',
      'const entry = path.join(path.dirname(process.execPath), "app", "dist", "bin.js");',
      'import(pathToFileURL(entry).href).catch((e) => { console.error("imgfit: không nạp được app/:", e); process.exit(3); });',
    ].join("\n"),
  );
  await writeFile(path.join(seaDir, "sea.json"), JSON.stringify({ main: path.join(seaDir, "main.cjs"), output: path.join(seaDir, "sea.blob"), disableExperimentalSEAWarning: true }));
  sh(process.execPath, ["--experimental-sea-config", path.join(seaDir, "sea.json")]);
  const exe = path.join(out, win ? "imgfit.exe" : "imgfit-bin");
  await copyFile(process.execPath, exe);
  if (process.platform === "darwin") spawnSync("codesign", ["--remove-signature", exe], { stdio: "inherit" });
  const postject = path.join(root, "node_modules", "postject", "dist", "cli.js");
  const extra = process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [];
  sh(process.execPath, [postject, exe, "NODE_SEA_BLOB", path.join(seaDir, "sea.blob"), "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...extra]);
  if (process.platform === "darwin") spawnSync("codesign", ["--sign", "-", exe], { stdio: "inherit" });
  await rm(seaDir, { recursive: true, force: true });
  if (win) console.error("! imgfit.exe (SEA) chưa được ký: Windows Smart App Control/AppLocker có thể chặn. Ký bằng signtool trước khi phát hành, hoặc dùng imgfit.cmd / node.exe + app.");
}

// Smoke test the bundle itself (its own node binary, not the build machine's Node)
const smoke = spawnSync(path.join(out, nodeName), [path.join(app, "dist", "bin.js"), "capabilities", "--json"], { encoding: "utf8" });
if (smoke.status !== 0) throw new Error(`Smoke test thất bại: ${smoke.stderr}`);
const caps = JSON.parse(smoke.stdout);
console.error(`✓ smoke: imgfit ${caps.versions.imgfit} · sharp ${caps.versions.sharp} · output ${caps.output.join(",")}`);

// Archive
async function walk(dir, base = dir) {
  const res = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...(await walk(p, base)));
    else if (e.isFile()) res.push({ name: path.relative(base, p).split(path.sep).join("/"), file: p });
  }
  return res;
}
let archive;
if (win) {
  const { writeZip } = await import(new URL("../dist/io/zip.js", import.meta.url).href);
  archive = `${out}.zip`;
  const entries = (await walk(out)).map((e) => ({ name: `${name}/${e.name}`, file: e.file }));
  const ws = createWriteStream(archive);
  await writeZip(ws, entries);
  await new Promise((r, j) => ws.end((err) => (err ? j(err) : r())));
} else {
  archive = `${out}.tar.gz`;
  sh("tar", ["-czf", archive, "-C", outRoot, name]);
}
console.error(`✓ ${path.relative(root, archive)} (${((await stat(archive)).size / 1024 / 1024).toFixed(1)} MB)`);
