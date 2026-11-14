# Windows PowerShell: resize rồi đọc report JSON.
#   powershell -File examples/shell/resize.ps1 <thư-mục-ảnh> <thư-mục-output>
param(
  [string]$Src = "raw",
  [string]$Dst = "out"
)

$bin = if ($env:IMGFIT_BIN) { $env:IMGFIT_BIN } else { "imgfit" }

# Đặt template trong nháy đơn để PowerShell không hiểu {…} là scriptblock.
$json = & $bin resize $Src -r --size 256x256 --mode cover --format webp `
  --output $Dst --name '{dir}/{name}.{ext}' --json
$code = $LASTEXITCODE

$report = ($json -join "`n") | ConvertFrom-Json
if ($report.status -eq "error") {
  $report.errors | ForEach-Object { Write-Error "[$($_.code)] $($_.message)" }
  exit $code
}
$report.files | ForEach-Object {
  $err = if ($_.errors.Count -gt 0) { "  [$($_.errors[0].code)]" } else { "" }
  "{0,-9} {1} -> {2}{3}" -f $_.status, $_.file, $_.destination, $err
}
"status=$($report.status) created=$($report.summary.created) failed=$($report.summary.failed)"
exit $code
