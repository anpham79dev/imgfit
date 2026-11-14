"""Python: calls the imgfit CLI and reads the JSON report. No third-party packages needed.

    python examples/python/resize.py <image-dir> <output-dir>

Binary lookup order: the IMGFIT_BIN environment variable, then `imgfit` on PATH.
"""

import json
import os
import shutil
import subprocess
import sys


def imgfit_bin() -> str:
    path = os.environ.get("IMGFIT_BIN") or shutil.which("imgfit")
    if not path:
        sys.exit("Không tìm thấy imgfit: cài bằng npm hoặc đặt IMGFIT_BIN")
    return path


def resize(input_dir: str, output_dir: str) -> dict:
    # Pass an argument LIST, no shell → no quoting/injection issues.
    proc = subprocess.run(
        [imgfit_bin(), "resize", input_dir, "-r",
         "--size", "256x256", "--mode", "cover", "--format", "webp",
         "--output", output_dir, "--name", "{dir}/{name}.{ext}", "--json"],
        capture_output=True, text=True, encoding="utf-8",
    )
    # with --json stdout is always JSON, even on failure (exit != 0)
    report = json.loads(proc.stdout)
    report["_exit"] = proc.returncode
    return report


if __name__ == "__main__":
    # imgfit messages are UTF-8 (Vietnamese); legacy Windows consoles may use cp1252.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    src = sys.argv[1] if len(sys.argv) > 1 else "raw"
    dst = sys.argv[2] if len(sys.argv) > 2 else "out"
    report = resize(src, dst)

    if report["status"] == "error":  # bad arguments / input not found (exit 2) or environment error (exit 3)
        for e in report["errors"]:
            print(f"[{e['code']}] {e['message']}", file=sys.stderr)
        sys.exit(report["_exit"])

    for f in report["files"]:
        err = f["errors"][0] if f["errors"] else None
        line = f"{f['status']:<9} {f['file']} -> {f['destination']}"
        print(line + (f"  [{err['code']}] {err['message']}" if err else ""))
    s = report["summary"]
    print(f"status={report['status']} created={s['created']} failed={s['failed']}")
    sys.exit(report["_exit"])
