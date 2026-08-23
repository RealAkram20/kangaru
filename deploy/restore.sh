#!/bin/bash
# =============================================================================
# KangaruRide — MySQL restore (W1-a)
# =============================================================================
#
# Restores ONE dump made by backup.sh into the live database, replacing it.
# Runs inside the `backup` service:
#
#   docker compose exec backup /opt/kangaruride/restore.sh --list
#   docker compose exec backup /opt/kangaruride/restore.sh <file.sql.gz> --yes
#
# It DROPS AND RECREATES the database first. A restore that merely replays
# `DROP TABLE IF EXISTS` over the top would leave behind any table created
# after the dump was taken — and would call itself a restore. Because of the
# drop it needs root (DB_ROOT_PASSWORD), which the application never has.
#
# This is an outage for as long as it runs — the API is answering 500s until
# the load completes. Timed and printed at the end, because "how long does a
# restore take" is a question the runbook must answer with a number.
#
# The `--yes` is not decoration. Without it the script prints what it would
# do and exits 3.
# =============================================================================
set -euo pipefail

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${DB_DATABASE:?DB_DATABASE is required}"
: "${DB_ROOT_PASSWORD:?DB_ROOT_PASSWORD is required}"
: "${BACKUP_DIR:=/backups}"

log() { printf '[restore %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

if [ "${1:-}" = "--list" ] || [ -z "${1:-}" ]; then
  echo "Backups in ${BACKUP_DIR}:"
  ls -1lh "$BACKUP_DIR"/kangaruride-*.sql.gz 2>/dev/null || echo "  (none)"
  echo
  echo "usage: restore.sh <file.sql.gz> --yes"
  exit 0
fi

file="$1"
confirm="${2:-}"
case "$file" in
  /*) ;;
  *)  file="$BACKUP_DIR/$file" ;;
esac

[ -f "$file" ] || { log "no such file: $file"; exit 2; }
gzip -t "$file" || { log "not a valid gzip: $file"; exit 2; }

echo
echo "  About to DROP DATABASE \`${DB_DATABASE}\` on ${DB_HOST} and reload it from:"
echo "    $file  ($(stat -c %s "$file") bytes, $(date -u -r "$file" +%FT%TZ))"
echo
if [ "$confirm" != "--yes" ]; then
  echo "  Re-run with --yes to proceed. Nothing has been changed."
  exit 3
fi

creds="$(mktemp)"
chmod 600 "$creds"
printf '[client]\nhost=%s\nport=%s\nuser=root\npassword=%s\n' \
  "$DB_HOST" "$DB_PORT" "$DB_ROOT_PASSWORD" > "$creds"
trap 'rm -f "$creds"' EXIT

started=$(date +%s)

log "drop and recreate ${DB_DATABASE}"
mysql --defaults-extra-file="$creds" -e \
  "DROP DATABASE IF EXISTS \`${DB_DATABASE}\`; CREATE DATABASE \`${DB_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

log "loading $file"
gunzip -c "$file" | mysql --defaults-extra-file="$creds" "$DB_DATABASE"

finished=$(date +%s)
tables=$(mysql --defaults-extra-file="$creds" -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_DATABASE}';")

log "done: ${tables} tables in $((finished - started))s"
echo "RESTORE_SECONDS=$((finished - started))"
