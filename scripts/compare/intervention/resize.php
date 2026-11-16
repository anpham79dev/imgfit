<?php
// Typical hand-written Intervention Image v2 code:
//   landscape (w > h) → resize by width, otherwise by height; aspectRatio(); save as .jpg.
//   Optionally upsize() (in v2 that means "do not enlarge"), which much hand-written code forgets.
//
//   php resize.php <jobs.json>      jobs: [{"in","out","w","h","quality"?,"noEnlarge"?}]
// Prints one JSON line per job: {"out","ms","w","h"} or {"out","error"}.
require '/opt/iv/vendor/autoload.php';
use Intervention\Image\ImageManager;

$m = new ImageManager(['driver' => 'gd']);
$jobs = json_decode(file_get_contents($argv[1]), true);
foreach ($jobs as $j) {
    try {
        $t0 = microtime(true);
        $img = $m->make($j['in'])->orientate();
        $noEnlarge = !empty($j['noEnlarge']);
        $cb = function ($c) use ($noEnlarge) {
            $c->aspectRatio();
            if ($noEnlarge) {
                $c->upsize();
            }
        };
        if ($img->width() > $img->height()) {
            $img->resize((int)$j['w'], null, $cb);
        } else {
            $img->resize(null, (int)$j['h'], $cb);
        }
        isset($j['quality']) ? $img->save($j['out'], (int)$j['quality']) : $img->save($j['out']);
        echo json_encode(['out' => $j['out'], 'ms' => round((microtime(true) - $t0) * 1000), 'w' => $img->width(), 'h' => $img->height()]), "\n";
        $img->destroy();
    } catch (\Throwable $e) {
        echo json_encode(['out' => $j['out'], 'error' => $e->getMessage()]), "\n";
    }
}
