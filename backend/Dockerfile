# syntax=docker/dockerfile:1.7
# =============================================================================
# KangaruRide API — one image, three processes (W1-a)
# =============================================================================
#
# The same image runs as `app` (nginx + php-fpm), `queue` (queue:work) and
# `scheduler` (schedule:work); docker-compose.yml picks the command. One
# image, so the three can never disagree about which code they run.
#
# Base: serversideup/php — nginx + PHP-FPM in one container (the topology
# AGENTS.md "Process" names for production), non-root, opcache on, healthcheck
# built in, PHP 8.4 to match CI and AGENTS.md's stated production spec.
# https://serversideup.net/open-source/docker-php/
#
# The build never reads a `.env` and never runs a seeder. Config caching
# happens at container START (docker/entrypoint.d), because that is when the
# environment exists.
# -----------------------------------------------------------------------------

ARG PHP_IMAGE=serversideup/php:8.4-fpm-nginx-alpine

FROM ${PHP_IMAGE} AS base

# --- extensions the lockfile needs and the base does not ship -----------------
# gd: dompdf (invoice/report PDFs) and bacon-qr-code (MFA enrolment QR).
# Everything else — pdo_mysql, redis, bcmath, intl, opcache, pcntl, zip — is
# already in the base image; `install-php-extensions` is a no-op for those.
USER root
RUN install-php-extensions gd

# Composer from the official image rather than curl|sh: pinned major, no
# network fetch of an installer script at build time.
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

WORKDIR /var/www/html

# --- dependencies first, so a source change does not re-download vendor -------
COPY --chown=www-data:www-data composer.json composer.lock ./
RUN composer install \
      --no-dev --no-scripts --no-autoloader --no-interaction --no-progress \
      --prefer-dist \
 && rm -rf /root/.composer /tmp/*

# --- application ---------------------------------------------------------------
# .dockerignore keeps .env*, tests, storage contents and node_modules out.
COPY --chown=www-data:www-data . .

# The autoloader with the full source present, then Laravel's package
# discovery (the post-autoload-dump script we skipped above, minus anything
# that would need a database). No `.env` exists here and none is needed.
RUN composer dump-autoload --optimize --classmap-authoritative --no-dev \
 && php artisan package:discover --ansi \
 && mkdir -p storage/app/private storage/app/public \
             storage/framework/cache/data storage/framework/sessions \
             storage/framework/testing storage/framework/views \
             storage/logs bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache public \
 && chmod -R ug+rwX storage bootstrap/cache

# --- start-up hooks -------------------------------------------------------------
# The base image runs every executable /etc/entrypoint.d/*.sh, in order,
# before the main process. Ours: 10 caches config/routes/views for THIS
# container; 50 runs the release step (migrate, storage:link) only where
# RELEASE_TASKS=true — the `app` service, once, never the workers.
COPY --chmod=0755 docker/entrypoint.d/ /etc/entrypoint.d/

# Production PHP limits the base image reads at start. Uploads: driver
# documents and odometer photos are capped at 8 MB by the API; 12 MB leaves
# room for the multipart envelope. Everything else is the base's tuned default.
ENV PHP_OPCACHE_ENABLE=1 \
    PHP_MEMORY_LIMIT=256M \
    PHP_POST_MAX_SIZE=12M \
    PHP_UPLOAD_MAX_FILE_SIZE=12M \
    AUTORUN_ENABLED=false \
    SHOW_WELCOME_MESSAGE=false

USER www-data

# nginx listens on 8080 as www-data; php-fpm behind it. The compose file
# overrides the healthcheck to hit Laravel's own /up so "healthy" means the
# framework booted, not merely that nginx answered.
EXPOSE 8080
