#!/usr/bin/env bash
# Shell / CI: resize, then filter the report with jq (if installed).
#   bash examples/shell/resize.sh <image-dir> <output-dir>
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

# 0 = ok, 1 = some file failed, 2 = bad arguments, 3 = environment error, 130 = cancelled
exit "$code"
