#!/bin/sh
# Cache config, routes, events and views for THIS container (W1-a).
#
# Runs in app, queue and scheduler alike — each has its own filesystem, so
# each caches its own. The environment is complete by now (Coolify injected
# it), which is why this happens at start and not at build.
#
# `route:cache` refuses closure routes, `config:cache` refuses env() calls
# outside config/ — either failure stops the container from starting, which
# is the correct loud failure: a container serving uncached config is a
# container that behaves differently from the one you tested.
set -eu

cd /var/www/html

php artisan optimize --no-interaction
