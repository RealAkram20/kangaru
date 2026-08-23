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
# The base ships opcache, pcntl, pdo_mysql, redis, zip on top of php's own
# (mbstring, dom, fileinfo, tokenizer, ...). Verified against its Dockerfile,
# not assumed. Missing and needed here:
#   bcmath — money arithmetic (AGENTS.md Money & Billing)
#   intl   — locale/number formatting used by the framework and dompdf
#   gd     — dompdf (invoice/report PDFs) and bacon-qr-code (MFA enrolment)
# Composer is already in the base image (COPY --from=composer:2).
USER root
RUN install-php-extensions bcmath gd intl

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
RUN composer dump-autoload --optimize --no-dev \
 && php artisan package:discover --ansi \
 && mkdir -p storage/app/private storage/app/public \
             storage/framework/cache/data storage/framework/sessions \
             storage/framework/testing storage/framework/views \
             storage/logs bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache public \
 && chmod -R ug+rwX storage bootstrap/cache

# --- start-up hooks -------------------------------------------------------------
# The base image sources every /etc/entrypoint.d/*.sh in a subshell, in
# order, before `exec`-ing the command — for the default nginx+fpm and for
# the queue/scheduler command overrides alike (verified in its entrypoint
# script). Ours: 10 caches config/routes/views for THIS
# container; 50 runs the release step (migrate, storage:link) only where
# RELEASE_TASKS=true — the `app` service, once, never the workers.
COPY --chmod=0755 docker/entrypoint.d/ /etc/entrypoint.d/

# Production PHP limits the base image reads at start.
#
# **Uploads, and these three numbers have to be read together.** The worklog's
# 2026-08-18 03:20 entry proved every upload on this platform was capped at
# 2 MB by PHP's stock `upload_max_filesize`, silently: the file is discarded
# before Laravel sees it, so a perfectly good request fails validation as
# though nothing was sent. A stock PHP image ships that same 2 M default, so
# it would have recurred here.
#
# The API's own ceilings, read from the request classes rather than assumed:
# driver photo 4 MB (`StoreDriverPhotoRequest`), driver documents 8 MB
# (`StoreDriverDocumentRequest`), **odometer dashboard photo 10 MB**
# (`TransitionTripRequest`, `max:10240`) — that last one is the anchor
# client's evidence for a reading, and a camera photo routinely exceeds 2 MB.
#
# So `upload_max_filesize` = 12M covers the largest ceiling with headroom, and
# `post_max_size` must be **strictly larger** — it bounds the whole multipart
# body, file plus fields plus boundaries, and when it is exceeded PHP discards
# the entire body rather than the file. Setting the two equal, as this file
# did until now, means an upload at exactly the limit fails wholesale.
# nginx's own body limit has to clear post_max_size for the same reason, or
# the request never reaches PHP at all.
ENV PHP_OPCACHE_ENABLE=1 \
    PHP_MEMORY_LIMIT=256M \
    PHP_UPLOAD_MAX_FILE_SIZE=12M \
    PHP_POST_MAX_SIZE=16M \
    NGINX_CLIENT_MAX_BODY_SIZE=16M \
    NGINX_WEBROOT=/var/www/html/public \
    HEALTHCHECK_PATH=/up \
    AUTORUN_ENABLED=false \
    SHOW_WELCOME_MESSAGE=false

# Which build is this? Without it, "roll back to the previous version" cannot
# be verified — the stack looks identical before and after, and an operator
# has no way to answer "what is actually running right now?" at 2am.
# `docker compose exec app printenv APP_BUILD` answers it; docs/runbook.md
# uses it as the first question of every incident and as the proof that a
# rollback landed.
ARG APP_BUILD=unknown
ENV APP_BUILD=${APP_BUILD}

USER www-data

# nginx listens on 8080 as www-data; php-fpm behind it. The compose file
# overrides the healthcheck to hit Laravel's own /up so "healthy" means the
# framework booted, not merely that nginx answered.
EXPOSE 8080
