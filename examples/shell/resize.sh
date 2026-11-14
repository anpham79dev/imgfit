#!/usr/bin/env bash
# Shell / CI: resize rồi lọc report bằng jq (nếu có).
#   bash examples/shell/resize.sh <thư-mục-ảnh> <thư-mục-output>
set -euo pipefail

SRC="${1:-raw}"
DST="${2:-out}"
BIN="${IMGFIT_BIN:-imgfit}"

set +e
"$BIN" resize "$SRC" -r --size 256x256 --mode cover --format webp \
  --output "$DST" --name "{dir}/{name}.{ext}" --json > imgfit-report.json
code=$?
set -e

if command -v jq >/dev/null 2>&1; then
  jq -r '.files[]? | "\(.status)\t\(.file) -> \(.destination // "?")\t\(.errors[0].code // "")"' imgfit-report.json
  jq -r '"status=\(.status)"' imgfit-report.json
else
  echo "Report: imgfit-report.json (cài jq để xem gọn hơn)"
fi

# 0 = ok, 1 = có file lỗi, 2 = sai tham số, 3 = lỗi môi trường, 130 = bị hủy
exit "$code"
