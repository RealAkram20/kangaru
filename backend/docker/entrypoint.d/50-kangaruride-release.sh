#!/bin/sh
# The release step (W1-a). Runs ONLY where RELEASE_TASKS=true — the `app`
# service. Workers wait for `app` to be healthy (docker-compose.yml
# depends_on), so by the time they start, migrations are done.
#
# What it does, and the one thing it must never do:
#   php artisan migrate --force      — and NOTHING else on the schema.
#   php artisan storage:link         — public/storage → storage/app/public.
#
# No `--seed`. No `db:seed`. `DriverAppSeeder` creates a Super Admin whose
# TOTP secret is committed to this repository; running it against production
# hands anyone who has read the repo a working MFA second factor.
# (backend/.env.production.example, last section; master-plan.md §5.)
set -eu

if [ "${RELEASE_TASKS:-false}" != "true" ]; then
  exit 0
fi

cd /var/www/html

# Wait for MySQL to accept a connection with the app's own credentials.
# compose's depends_on already waited for the container's healthcheck; this
# covers the gap between "mysqld answers ping" and "the app user can log in",
# and any restart of `app` alone while MySQL is still coming up.
attempt=0
until php -r '
  $dsn = sprintf("mysql:host=%s;port=%s;dbname=%s", getenv("DB_HOST"), getenv("DB_PORT") ?: "3306", getenv("DB_DATABASE"));
  try { new PDO($dsn, getenv("DB_USERNAME"), getenv("DB_PASSWORD"), [PDO::ATTR_TIMEOUT => 3]); exit(0); }
  catch (Throwable $e) { fwrite(STDERR, $e->getMessage() . PHP_EOL); exit(1); }
' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "[release] database not reachable after ${attempt} attempts — giving up" >&2
    exit 1
  fi
  echo "[release] waiting for database (${attempt}/60)"
  sleep 2
done

echo "[release] migrate --force"
php artisan migrate --force --no-interaction

echo "[release] storage:link"
php artisan storage:link --force --no-interaction

echo "[release] done"
