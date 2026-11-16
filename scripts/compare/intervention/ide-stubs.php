<?php
// IDE-only stubs: intervention/image is installed by composer INSIDE the Docker image (see Dockerfile),
// so editors on the host cannot resolve it. This file is never copied into the image or executed.
// Signatures follow intervention/image 2.7.2.

namespace Intervention\Image;

class ImageManager
{
    /** @param array{driver?: string} $config */
    public function __construct(array $config = []) {}

    /** @param mixed $data */
    public function make($data): Image
    {
        return new Image();
    }
}

class Image
{
    public function orientate(): Image
    {
        return $this;
    }

    public function width(): int
    {
        return 0;
    }

    public function height(): int
    {
        return 0;
    }

    public function resize(?int $width = null, ?int $height = null, ?\Closure $callback = null): Image
    {
        return $this;
    }

    public function save(?string $path = null, ?int $quality = null, ?string $format = null): Image
    {
        return $this;
    }

    public function destroy(): void {}
}
