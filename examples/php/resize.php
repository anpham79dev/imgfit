<?php
// PHP thuần (không framework): gọi CLI imgfit, đọc JSON report.
//   php examples/php/resize.php <thư-mục-ảnh> <thư-mục-output>
// Laravel: xem README (Illuminate\Support\Facades\Process).

declare(strict_types=1);

function imgfitBin(): string
{
    $bin = getenv('IMGFIT_BIN');
    if ($bin !== false && $bin !== '') {
        return $bin;
    }
    return PHP_OS_FAMILY === 'Windows' ? 'imgfit.cmd' : 'imgfit';
}

$src = $argv[1] ?? 'raw';
$dst = $argv[2] ?? 'out';

// Mảng lệnh (PHP 7.4+) → proc_open không đi qua shell.
$cmd = [imgfitBin(), 'resize', $src, '-r',
    '--size', '256x256', '--mode', 'cover', '--format', 'webp',
    '--output', $dst, '--name', '{dir}/{name}.{ext}', '--json'];

$proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
if (!is_resource($proc)) {
    fwrite(STDERR, "Không chạy được imgfit\n");
    exit(3);
}
$stdout = stream_get_contents($pipes[1]);
$stderr = stream_get_contents($pipes[2]);
fclose($pipes[1]);
fclose($pipes[2]);
$exit = proc_close($proc);

$report = json_decode($stdout, true, 512, JSON_THROW_ON_ERROR);

if ($report['status'] === 'error') {
    foreach ($report['errors'] as $e) {
        fwrite(STDERR, "[{$e['code']}] {$e['message']}\n");
    }
    exit($exit);
}

foreach ($report['files'] as $f) {
    $err = $f['errors'][0] ?? null;
    printf("%-9s %s -> %s%s\n", $f['status'], $f['file'], $f['destination'] ?? '?', $err ? "  [{$err['code']}] {$err['message']}" : '');
}
printf("status=%s created=%d failed=%d\n", $report['status'], $report['summary']['created'], $report['summary']['failed']);
exit($exit);
