"""Python: gọi CLI imgfit, đọc JSON report. Không cần thư viện ngoài.

    python examples/python/resize.py <thư-mục-ảnh> <thư-mục-output>

Tìm binary theo thứ tự: biến môi trường IMGFIT_BIN, rồi `imgfit` trên PATH.
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
    # Truyền MẢNG tham số, không qua shell → không lo quoting/injection.
    proc = subprocess.run(
        [imgfit_bin(), "resize", input_dir, "-r",
         "--size", "256x256", "--mode", "cover", "--format", "webp",
         "--output", output_dir, "--name", "{dir}/{name}.{ext}", "--json"],
        capture_output=True, text=True, encoding="utf-8",
    )
    # stdout luôn là JSON khi có --json, kể cả khi lỗi (exit != 0)
    report = json.loads(proc.stdout)
    report["_exit"] = proc.returncode
    return report


if __name__ == "__main__":
    # Message của imgfit là UTF-8 (tiếng Việt); console Windows cũ có thể dùng cp1252.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    src =sys.argv[1] if len(sys.argv) > 1 else "raw"
    dst = sys.argv[2] if len(sys.argv) > 2 else "out"
    report = resize(src, dst)

    if report["status"] == "error":  # sai tham số / không tìm thấy input (exit 2) hoặc lỗi môi trường (exit 3)
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
