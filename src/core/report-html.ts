import type { FileResult, Report } from "./report.js";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const bytes = (n: number | null) => (n === null ? "—" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const px = (p: [number, number] | null) => (p ? `${p[0]}×${p[1]}` : "—");

/** Static single-file HTML report: no scripts, no external resources — open directly or attach as a CI artifact. */
export function renderReportHtml(report: Report): string {
  const row = (f: FileResult) => `<tr class="st-${esc(f.status)}">
<td>${esc(f.status)}${f.action && f.status === "planned" ? ` · ${esc(f.action)}` : ""}</td>
<td class="p">${esc(f.file)}</td><td class="p">${esc(f.destination ?? "—")}</td>
<td>${esc(f.rule ?? "")}${f.preset ? ` / ${esc(f.preset)}` : ""}</td>
<td>${px(f.inputPx)} → ${px(f.outputPx)}</td><td>${bytes(f.inputBytes)} → ${bytes(f.outputBytes)}</td>
<td>${f.errors.map((e) => `<div class="e">${esc(e.code)}: ${esc(e.message)}</div>`).join("")}${f.warnings.map((w) => `<div class="w">${esc(w.code)}: ${esc(w.message)}</div>`).join("")}</td></tr>`;
  const s = report.summary;
  const counts = Object.entries(s)
    .filter(([k, v]) => v && !["inputBytes", "outputBytes", "bytesSaved", "total"].includes(k))
    .map(([k, v]) => `${esc(k)}: <b>${esc(v)}</b>`)
    .join(" · ");
  const issues = [...report.errors.map((e) => `<div class="e">${esc(e.code)}: ${esc(e.message)}</div>`), ...report.warnings.map((w) => `<div class="w">${esc(w.code)}: ${esc(w.message)}</div>`)].join("");
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>imgfit ${esc(report.command)} — ${esc(report.status)}</title>
<style>
body{font:13px system-ui,sans-serif;margin:24px;color:#1c2330;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e6e9ef;background:#12151b}th{background:#1b2029!important}}
h1{font-size:18px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #8884;vertical-align:top}
th{position:sticky;top:0;background:#f6f7f9}.p{font-family:ui-monospace,Consolas,monospace;word-break:break-all}
.e{color:#c62f2f}.w{color:#b26b00}tr.st-failed td:first-child,tr.st-fail td:first-child{color:#c62f2f;font-weight:bold}
tr.st-created td:first-child,tr.st-replaced td:first-child,tr.st-pass td:first-child{color:#138a4f}
</style></head><body>
<h1>imgfit ${esc(report.command)}${report.dryRun ? " (dry-run)" : ""} — ${esc(report.status.toUpperCase())}</h1>
<p>${esc(report.startedAt)} · ${(report.elapsedMs / 1000).toFixed(2)}s · imgfit ${esc(report.tool.version)} · sharp ${esc(report.tool.sharp)} · libvips ${esc(report.tool.libvips)}</p>
<p>${s.total} file · ${counts}${s.processed ? ` · tiết kiệm ${bytes(s.bytesSaved)}` : ""}</p>
${issues}
<table><thead><tr><th>Trạng thái</th><th>Nguồn</th><th>Output</th><th>Rule / preset</th><th>Kích thước</th><th>Dung lượng</th><th>Ghi chú</th></tr></thead>
<tbody>${report.files.map(row).join("\n")}</tbody></table>
</body></html>
`;
}
