# Intervention Image v2 (GD driver) — only used by scripts/compare to reproduce common hand-written resize code.
FROM php:8.3-cli-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libpng-dev libjpeg62-turbo-dev libwebp-dev libfreetype6-dev unzip \
 && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
 && docker-php-ext-install gd exif && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2.8 /usr/bin/composer /usr/bin/composer
WORKDIR /opt/iv
RUN composer require --no-interaction --no-progress intervention/image:2.7.2
COPY resize.php /opt/iv/resize.php
ENTRYPOINT ["php", "-d", "memory_limit=512M", "/opt/iv/resize.php"]
