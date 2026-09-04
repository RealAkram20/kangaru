#!/bin/bash
# =============================================================================
# KangaruRide — rollback (W1-d)
# =============================================================================
#
# AGENTS.md Delivery: deploys are "tagged, logged, and reversible" and the
# rollback is "written down and rehearsed before first client onboarding".
# This is the written-down half made executable, so the rehearsal has
# something to rehearse. docs/runbook.md §5 is the human procedure; this
# script is the part that must not be improvised at 2am.
#
#   rollback.sh --status            what is running, what would come out
#   rollback.sh --schema N --yes    undo N migration batches, timed
#   rollback.sh --verify <build>    assert the stack is on that build and well
#
# **What this script does NOT do: change which image is deployed.** That is
# Coolify's Deployments tab (redeploy the previous commit) or, on a plain
# Docker host, `SOURCE_COMMIT=<old> docker compose up -d`. Putting an image
# swap in a script that also touches the schema is how someone rolls back
# further than they meant to at 2am, in the dark, on a bad night.
#
# Order matters and the runbook states it: **schema down first, then code
# back** only when the new code cannot run against the old schema; otherwise
# code back first, because that is the fast half and it stops the bleeding.
# =============================================================================
set -euo pipefail

COMPOSE="${COMPOSE:-docker compose}"

log() { printf '[rollback %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
art() { $COMPOSE exec -T app php artisan "$@"; }

usage() {
  cat >&2 <<'USAGE'
usage:
  rollback.sh --status
  rollback.sh --schema <steps> --yes
  rollback.sh --verify <expected APP_BUILD>
USAGE
  exit 2
}

status() {
  echo "== what is running"
  # The first question of any incident, and the one nobody can answer without
  # this: which build is actually serving traffic?
  printf 'APP_BUILD: '
  $COMPOSE exec -T app printenv APP_BUILD 2>/dev/null || echo '(unset — image predates APP_BUILD)'
  $COMPOSE ps --format 'table {{.Service}}\t{{.Status}}' 2>/dev/null || true

  echo
  echo "== migrations that would come out with --schema 1"
  # `--pretend` prints the SQL without running it. If this prints nothing,
  # the last batch was empty and a schema rollback is not what you need.
  art migrate:rollback --step=1 --pretend --force --no-interaction 2>/dev/null || true

  echo
  echo "== most recent batch"
  art tinker --execute='
    $b = DB::table("migrations")->max("batch");
    $rows = DB::table("migrations")->where("batch", $b)->orderBy("id")->pluck("migration");
    echo "batch {$b}: " . $rows->count() . " migration(s)" . PHP_EOL;
    foreach ($rows as $r) { echo "  - {$r}" . PHP_EOL; }
  ' 2>/dev/null || true
}

schema_rollback() {
  local steps="$1" confirm="${2:-}" started finished
  [ "$confirm" = "--yes" ] || {
    echo "Refusing: re-run with --yes. Nothing has been changed." >&2
    exit 3
  }

  # A backup FIRST, always, and the rollback stops if it fails. `down()` is
  # reversible by definition and destructive in practice — a dropped column
  # takes its data with it, and no `up()` puts that back.
  log "taking a pre-rollback backup"
  $COMPOSE exec -T backup /bin/bash /opt/kangaruride/backup.sh --once

  started=$(date +%s)

  # Workers first. A queue job written against the new schema, picked up
  # mid-rollback, fails against the old one and lands in failed_jobs — which
  # then looks like the rollback broke something.
  log "stopping queue and scheduler"
  $COMPOSE stop queue scheduler

  # Count what is applied before and after. This is not belt-and-braces: with
  # the image already swapped back, `migrate:rollback` cannot find the
  # migration file it is supposed to reverse and **rolls back nothing while
  # reporting success** — it prints "Rolling back migrations." and exits 0.
  # Proved in CI (run 32126492421): the script said "done in 12s", --verify
  # passed, the app was healthy, and the schema had not moved. A rollback
  # script that lies is worse than no script, so this refuses to claim a
  # rollback it did not perform.
  local before after
  before=$(art tinker --execute='echo DB::table("migrations")->count();' | tr -d '\r\n ')

  log "migrate:rollback --step=${steps}"
  art migrate:rollback --step="$steps" --force --no-interaction

  after=$(art tinker --execute='echo DB::table("migrations")->count();' | tr -d '\r\n ')
  if [ "$after" -ge "$before" ]; then
    log "FAILED — ${before} migrations before, ${after} after: nothing was rolled back."
    log "The usual cause is that the code was put back FIRST: down() lives in"
    log "the new image, so the migration file is no longer there to reverse."
    log "Redeploy the newer build, roll the schema back, THEN go back again."
    log "The pre-rollback backup above is untouched. See docs/runbook.md §5.3."
    $COMPOSE start queue scheduler
    return 1
  fi
  log "migrations applied: ${before} -> ${after}"

  log "restarting queue and scheduler"
  $COMPOSE start queue scheduler

  finished=$(date +%s)
  log "schema rollback done in $((finished - started))s"
  echo "ROLLBACK_SECONDS=$((finished - started))"
}

verify() {
  local expected="$1" actual code
  actual=$($COMPOSE exec -T app printenv APP_BUILD | tr -d '\r\n')
  [ "$actual" = "$expected" ] || {
    echo "FAIL: APP_BUILD is '${actual}', expected '${expected}'" >&2
    exit 1
  }
  code=$(curl -s -o /dev/null -w '%{http_code}' "${APP_URL:-http://localhost:18080}/up")
  [ "$code" = "200" ] || { echo "FAIL: /up returned ${code}" >&2; exit 1; }
  log "verified: APP_BUILD=${actual}, /up 200"
}

case "${1:-}" in
  --status) status ;;
  --schema) [ $# -ge 2 ] || usage; schema_rollback "$2" "${3:-}" ;;
  --verify) [ $# -ge 2 ] || usage; verify "$2" ;;
  *) usage ;;
esac
