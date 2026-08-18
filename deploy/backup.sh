#!/bin/bash
# =============================================================================
# KangaruRide — MySQL backup (W1-a)
# =============================================================================
#
# Runs inside the `backup` service (image mysql:8.4, so mysqldump matches the
# server). Two modes:
#
#   backup.sh --once     take one dump now and exit (what CI and a human run)
#   backup.sh --loop     take one dump now, then one every day at
#                        BACKUP_UTC_TIME, forever (the container's entrypoint)
#
# Output: $BACKUP_DIR/kangaruride-<db>-<UTC timestamp>.sql.gz — a logical
# dump with routines, triggers and events, taken under --single-transaction
# so it is consistent without locking the tables dispatch is writing to.
# Dumps older than BACKUP_KEEP_DAYS are deleted after each successful run,
# never before it: a failed dump must not shrink the set you already have.
#
# What this does NOT cover, and says so: the `app-storage` volume (driver
# documents, odometer photos, report exports). Back that up at the host.
#
# Restore: deploy/restore.sh. Rehearse it — deploy/README.md — before the
# first client data lands. An untested backup is not a backup.
# =============================================================================
set -euo pipefail

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=3306}"
: "${DB_DATABASE:?DB_DATABASE is required}"
: "${DB_USERNAME:?DB_USERNAME is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_UTC_TIME:=23:15}"
: "${BACKUP_KEEP_DAYS:=14}"

log() { printf '[backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

# The password goes to mysqldump through a defaults file, not argv — argv is
# readable by every process in the container via /proc.
credentials_file() {
  local f
  f="$(mktemp)"
  chmod 600 "$f"
  printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' \
    "$DB_HOST" "$DB_PORT" "$DB_USERNAME" "$DB_PASSWORD" > "$f"
  echo "$f"
}

take_backup() {
  local creds stamp target tmp started finished bytes
  mkdir -p "$BACKUP_DIR"
  creds="$(credentials_file)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$BACKUP_DIR/kangaruride-${DB_DATABASE}-${stamp}.sql.gz"
  tmp="${target}.partial"
  started=$(date +%s)

  log "dumping ${DB_DATABASE} from ${DB_HOST} -> ${target}"

  # --no-tablespaces: since 8.0.21 mysqldump wants PROCESS to dump tablespace
  # metadata, and the application user deliberately does not have it.
  # --set-gtid-purged=OFF: this is not a replica seed.
  # A failure anywhere in the pipe fails the run (pipefail) and leaves only
  # the .partial file, which is removed.
  if ! mysqldump --defaults-extra-file="$creds" \
        --single-transaction --quick \
        --routines --triggers --events \
        --no-tablespaces --set-gtid-purged=OFF \
        --default-character-set=utf8mb4 \
        "$DB_DATABASE" | gzip -6 > "$tmp"; then
    rm -f "$tmp" "$creds"
    log "FAILED — no new backup written"
    return 1
  fi
  rm -f "$creds"

  # A dump that is not a valid gzip, or is implausibly small, is not kept as
  # if it were one. An empty schema still dumps to well over a kilobyte.
  if ! gzip -t "$tmp"; then
    rm -f "$tmp"
    log "FAILED — gzip integrity check"
    return 1
  fi
  bytes=$(stat -c %s "$tmp")
  if [ "$bytes" -lt 1024 ]; then
    rm -f "$tmp"
    log "FAILED — dump is ${bytes} bytes, refusing to keep it"
    return 1
  fi

  mv "$tmp" "$target"
  finished=$(date +%s)
  log "done: ${bytes} bytes in $((finished - started))s"

  # Retention, only after success.
  find "$BACKUP_DIR" -maxdepth 1 -name 'kangaruride-*.sql.gz' -type f \
       -mtime "+${BACKUP_KEEP_DAYS}" -print -delete | sed 's/^/[backup] pruned /' || true

  log "kept: $(find "$BACKUP_DIR" -maxdepth 1 -name 'kangaruride-*.sql.gz' -type f | wc -l) file(s)"
}

seconds_until_next() {
  # Seconds from now until the next occurrence of BACKUP_UTC_TIME (HH:MM).
  local now next
  now=$(date -u +%s)
  next=$(date -u -d "today ${BACKUP_UTC_TIME}" +%s)
  if [ "$next" -le "$now" ]; then
    next=$(date -u -d "tomorrow ${BACKUP_UTC_TIME}" +%s)
  fi
  echo $((next - now))
}

case "${1:---once}" in
  --once)
    take_backup
    ;;
  --loop)
    log "loop: daily at ${BACKUP_UTC_TIME} UTC, keeping ${BACKUP_KEEP_DAYS} days, in ${BACKUP_DIR}"
    # One on start, so a fresh deploy has a backup before the first client
    # data lands — and so a failing dump shows up in the logs immediately,
    # not at 02:15 tomorrow.
    take_backup || log "startup backup failed; will retry at the scheduled time"
    while true; do
      wait_for=$(seconds_until_next)
      log "next run in ${wait_for}s"
      sleep "$wait_for"
      take_backup || log "scheduled backup failed; will retry tomorrow"
    done
    ;;
  *)
    echo "usage: backup.sh [--once|--loop]" >&2
    exit 2
    ;;
esac
