#!/bin/bash
# =============================================================================
# KangaruRide — stack smoke test (W1-a)
# =============================================================================
#
# Proves, against a RUNNING copy of docker-compose.yml, the things
# master-plan.md §3 and §5 ask of the deployment:
#
#   1. all seven containers are up, each with a CPU and a memory limit
#   2. the API boots (/up), errors are JSON, the SPA serves and falls back
#   3. `schedule:list` shows exactly the seven commands routes/console.php has
#   4. a queued job is completed BY THE QUEUE CONTAINER, through Redis
#   5. the storage volume is one volume, shared by app and queue
#   6. a backup is taken, the database is mutated, the backup is restored,
#      the mutation is gone — and the restore is timed
#   7. no seeder ran: the demo driver does not exist
#
# Runs on the CI runner (see .github/workflows/ci.yml, job `deploy-stack`),
# or by hand against any host with the stack up:
#
#   COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.ci.yml \
#   APP_URL=http://localhost:18080 WEB_URL=http://localhost:18081 \
#   bash deploy/smoke.sh
#
# Every assertion is a COUNT or an exact value, not an existence check —
# the worklog records three lying tests on this branch, every one an
# existence assertion where a count was needed.
# =============================================================================
set -euo pipefail

APP_URL="${APP_URL:-http://localhost:18080}"
WEB_URL="${WEB_URL:-http://localhost:18081}"
EXPECTED_SERVICES="app backup mysql queue redis scheduler web"

pass=0
fail() { echo "  ✗ SMOKE FAIL: $*" >&2; exit 1; }
ok()   { pass=$((pass + 1)); echo "  ✓ $*"; }
dc()   { docker compose "$@"; }
# `exec -T` — no TTY on a runner. `artisan` output goes through tr to drop
# the CRs tinker sometimes emits.
art()  { dc exec -T app php artisan "$@" 2>/dev/null | tr -d '\r'; }
tinker() { dc exec -T app php artisan tinker --execute="$1" 2>/dev/null | tr -d '\r'; }

echo "== 1. containers and limits"
running=$(dc ps --status running --format '{{.Service}}' | sort | tr '\n' ' ' | sed 's/ $//')
[ "$running" = "$EXPECTED_SERVICES" ] || fail "running services: '$running' — expected '$EXPECTED_SERVICES'"
ok "7 services running: $running"

limited=0
for svc in $EXPECTED_SERVICES; do
  cid=$(dc ps -q "$svc")
  read -r mem cpus < <(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' "$cid")
  if [ "$mem" -gt 0 ] && [ "$cpus" -gt 0 ]; then
    limited=$((limited + 1))
  else
    echo "    $svc: memory=$mem nanocpus=$cpus" >&2
  fi
done
[ "$limited" -eq 7 ] || fail "only $limited/7 containers have both a memory and a CPU limit"
ok "7/7 containers have memory and CPU limits"

published=$(dc ps --format '{{.Service}} {{.Ports}}' | grep -vE '^(app|web) ' | grep -cE '0\.0\.0\.0|:::' || true)
[ "$published" -eq 0 ] || fail "$published non-HTTP service(s) publish a host port — mysql/redis must not"
ok "mysql, redis, queue, scheduler, backup publish no host port"

echo "== 2. HTTP"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/up")
[ "$code" = "200" ] || fail "GET /up returned $code"
ok "GET /up → 200"

body=$(curl -s -H 'Accept: application/json' "$APP_URL/api/v1/does-not-exist")
echo "$body" | grep -q '"code":"NOT_FOUND"' || fail "unknown API route did not return the JSON envelope: $body"
ok "unknown API route → JSON NOT_FOUND envelope"

root_code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/")
echo "  · GET / on the API host → $root_code (informational: the Laravel welcome view; see the worklog finding)"

debug=$(curl -s -H 'Accept: application/json' "$APP_URL/api/v1/does-not-exist" | grep -c '"exception"' || true)
[ "$debug" -eq 0 ] || fail "error response carries an exception body — APP_DEBUG is on"
ok "error responses carry no exception body (APP_DEBUG=false)"

code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL/healthz")
[ "$code" = "200" ] || fail "web /healthz returned $code"
roots=$(curl -s "$WEB_URL/" | grep -c 'id="root"' || true)
[ "$roots" -eq 1 ] || fail "web / did not serve the SPA shell (found $roots root divs)"
deep=$(curl -s "$WEB_URL/privacy" | grep -c 'id="root"' || true)
[ "$deep" -eq 1 ] || fail "web /privacy did not fall back to the SPA shell"
cache=$(curl -s -D - -o /dev/null "$WEB_URL/index.html" | grep -ci '^cache-control: no-store' || true)
[ "$cache" -eq 1 ] || fail "index.html is not sent with Cache-Control: no-store"
ok "web serves the SPA, falls back on deep links, index.html is no-store"

echo "== 3. scheduler"
schedule=$(art schedule:list --no-ansi)
count=0
# Seventh since ADR-0048 (21 August 2026): drivers:prune-abandoned-application-documents.
# The count is a tripwire, not a formality — it is what stops a command being
# added or silently dropped without a decision. This one is a data-protection
# obligation (a never-decided application's identity photographs, deleted at
# 90 days), so the right move was to move the number, not the command.
# Eighth, ninth and tenth, with the mail plan: invitations:remind (A2 — the link
# lapses tomorrow and nobody has used it), drivers:remind-expiring-documents (a
# permit that expires unannounced grounds a driver mid-shift) and
# fleets:alert-without-accounts (ADR-0059 §5 — a fleet with nobody to act as is
# unreachable to support for ever). Three commands, three decisions on the
# record, which is the whole job of the number below.
for name in reports:prune-exports sanctum:prune-expired dispatch:advance-offers drivers:award-weekly-bonuses duty:close-stale trip-locations:maintain drivers:prune-abandoned-application-documents invitations:remind drivers:remind-expiring-documents fleets:alert-without-accounts; do
  if echo "$schedule" | grep -q "$name"; then count=$((count + 1)); else echo "    missing: $name" >&2; fi
done
if [ "$count" -ne 10 ]; then
  echo "$schedule" >&2
  fail "schedule:list shows $count/10 expected commands"
fi
lines=$(echo "$schedule" | grep -c 'php artisan ' || true)
[ "$lines" -eq 10 ] || { echo "$schedule" >&2; fail "schedule:list has $lines scheduled entries, expected exactly 10"; }
ten=$(echo "$schedule" | grep 'dispatch:advance-offers' | grep -c ' 10s ' || true)
[ "$ten" -eq 1 ] || fail "dispatch:advance-offers is not on a ten-second cadence"
ok "schedule:list: exactly 10 entries, dispatch:advance-offers every 10 s"

sched_alive=$(dc exec -T scheduler sh -c "pgrep -f '[a]rtisan schedule:work' | wc -l" | tr -d '\r ' || true)
[ "$sched_alive" -eq 1 ] || fail "expected exactly 1 schedule:work process, found $sched_alive"
ok "schedule:work process alive in the scheduler container (exactly 1)"
queue_alive=$(dc exec -T queue sh -c "pgrep -f '[a]rtisan queue:work' | wc -l" | tr -d '\r ' || true)
[ "$queue_alive" -eq 1 ] || fail "expected exactly 1 queue:work process, found $queue_alive"
ok "queue:work process alive in the queue container (exactly 1)"

echo "== 4. queue through Redis"
# A sentinel goes into the cache from the app container; a QUEUED artisan
# command (Illuminate\Foundation\Console\QueuedCommand — a real job class,
# not a closure, which tinker's eval()'d code could not serialise) is
# dispatched to forget it. Only the queue container runs a worker, so the
# key disappearing proves that container completed the job — through the
# database queue and against the dedicated Redis.
tinker 'cache()->put("smoke:sentinel", "present", 600); echo cache()->get("smoke:sentinel");' | grep -q present || fail "could not seed the cache sentinel"
# Laravel's cache connection is REDIS_CACHE_DB, which defaults to database
# 1, while `redis-cli --scan` reads database 0. The first version of this
# check scanned db 0 and failed against a correctly wired stack — so the
# index is read from the running app rather than assumed here.
store=$(tinker 'echo config("cache.default");')
[ "$store" = "redis" ] || fail "cache.default is '$store', not redis — the dedicated Redis is not the cache"

# ADR-0003's silent failure, and the reason this check exists at all: BOTH of
# these default to `database`. A stack that provisions the dedicated Redis and
# leaves them unset comes up entirely healthy — every other check in this file
# passes — while live positions and driver presence go to MySQL and the Redis
# container sits idle. Nothing errors. The live map still draws, off the wrong
# store, and the growth risk ADR-0003 was written about is back.
positions=$(tinker 'echo config("tracking.live_positions_driver");')
[ "$positions" = "redis" ] || fail "tracking.live_positions_driver is '$positions', not redis — live positions are going to MySQL (ADR-0003)"
presence=$(tinker 'echo config("dispatch.presence_driver");')
[ "$presence" = "redis" ] || fail "dispatch.presence_driver is '$presence', not redis — driver presence is going to MySQL (ADR-0003)"
ok "live positions and driver presence both read redis (ADR-0003)"
cache_db=$(tinker 'echo config("database.redis.cache.database");')
in_redis=$(dc exec -T redis sh -c "redis-cli -a \"\$REDIS_PASSWORD\" --no-auth-warning -n ${cache_db} --scan --pattern '*smoke:sentinel*' | wc -l" | tr -d '\r ')
[ "$in_redis" -eq 1 ] || fail "expected the sentinel in redis db ${cache_db} (1 key), found $in_redis — CACHE_STORE is not wired to this Redis"
ok "cache sentinel lives in the dedicated Redis, db ${cache_db} (1 key)"

# Asserted from config rather than by counting rows in `jobs`: the worker
# polls continuously, so a count taken just after dispatch races it and
# would fail intermittently for the best possible reason. That the job went
# through the database queue is proved by the connection plus the worker's
# own log below.
conn=$(tinker 'echo config("queue.default");')
[ "$conn" = "database" ] || fail "queue.default is '$conn', not database (master-plan.md §3: durable across a Redis restart)"
tinker 'Artisan::queue("cache:forget", ["key" => "smoke:sentinel"]); echo "dispatched";' | grep -q dispatched || fail "could not dispatch the queued command"
ok "queue connection is database; cache:forget dispatched"

gone="no"
for _ in $(seq 1 30); do
  if [ "$(tinker 'echo cache()->has("smoke:sentinel") ? "yes" : "no";')" = "no" ]; then gone="yes"; break; fi
  sleep 2
done
[ "$gone" = "yes" ] || fail "queued job not completed within 60 s — the queue worker is not consuming"
# The worker logs a job by its DISPLAY name, not its class: QueuedCommand
# reports as the command string. Grepping for the class name found nothing
# while the log plainly read "cache:forget ... DONE" — so this asserts what
# the worker actually prints, and asserts exactly one completion.
processed=$(dc logs --no-color queue 2>/dev/null | grep -c 'cache:forget.*DONE' || true)
[ "$processed" -eq 1 ] || fail "expected exactly 1 'cache:forget ... DONE' line in the queue container's log, found $processed — something else consumed the job"
ok "queued job completed by the queue container (its log shows cache:forget DONE)"

failed=$(tinker 'echo DB::table("failed_jobs")->count();')
[ "$failed" = "0" ] || fail "failed_jobs has $failed row(s)"
left=$(tinker 'echo DB::table("jobs")->count();')
[ "$left" = "0" ] || fail "jobs table still has $left row(s)"
ok "failed_jobs = 0, jobs drained to 0"
queue_host=$(dc exec -T queue hostname | tr -d '\r')

echo "== 5. shared storage volume"
dc exec -T queue sh -c 'echo "$(hostname)" > /var/www/html/storage/app/private/.smoke-volume'
seen=$(dc exec -T app cat /var/www/html/storage/app/private/.smoke-volume | tr -d '\r')
[ "$seen" = "$queue_host" ] || fail "file written by queue not visible in app (got '$seen')"
dc exec -T app rm -f /var/www/html/storage/app/private/.smoke-volume
link=$(dc exec -T app sh -c 'readlink /var/www/html/public/storage' | tr -d '\r')
[ -n "$link" ] || fail "public/storage symlink missing — storage:link did not run"
ok "storage/app is one volume across app and queue; public/storage → $link"

echo "== 6. backup, mutate, restore"
dc exec -T backup /bin/bash /opt/kangaruride/backup.sh --once
dumps=$(dc exec -T backup sh -c 'ls -1 /backups/kangaruride-*.sql.gz | wc -l' | tr -d '\r ')
[ "$dumps" -ge 1 ] || fail "no dump written"
latest=$(dc exec -T backup sh -c 'ls -1t /backups/kangaruride-*.sql.gz | head -1' | tr -d '\r')
ok "backup written: $latest ($dumps on the volume)"

tinker 'DB::statement("CREATE TABLE smoke_restore (id INT PRIMARY KEY)"); DB::table("smoke_restore")->insert(["id" => 1]); echo "mutated";' | grep -q mutated || fail "could not mutate"
exists=$(tinker 'echo Schema::hasTable("smoke_restore") ? "yes" : "no";')
[ "$exists" = "yes" ] || fail "mutation did not land"

# Without --yes the script must refuse (exit 3) and change nothing.
set +e
dc exec -T backup /bin/bash /opt/kangaruride/restore.sh "$latest" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -eq 3 ] || fail "restore without --yes exited $rc, expected 3"
still=$(tinker 'echo Schema::hasTable("smoke_restore") ? "yes" : "no";')
[ "$still" = "yes" ] || fail "restore without --yes changed the database"
ok "restore refuses without --yes and changes nothing"

restore_out=$(dc exec -T backup /bin/bash /opt/kangaruride/restore.sh "$latest" --yes | tr -d '\r')
echo "$restore_out" | sed 's/^/    /'
secs=$(echo "$restore_out" | sed -n 's/^RESTORE_SECONDS=//p')
[ -n "$secs" ] || fail "restore did not report its duration"
gone=$(tinker 'echo Schema::hasTable("smoke_restore") ? "yes" : "no";')
[ "$gone" = "no" ] || fail "table created after the backup survived the restore — that is not a restore"
migrations=$(tinker 'echo DB::table("migrations")->count();')
[ "$migrations" -gt 0 ] || fail "migrations table empty after restore"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/up")
[ "$code" = "200" ] || fail "GET /up after restore returned $code"
ok "restore performed in ${secs}s: mutation gone, $migrations migrations back, API answering"

echo "== 7. no seeder ran"
demo=$(tinker 'echo DB::table("users")->whereIn("email", ["driver@kangaruride.test", "driver.free@kangaruride.test"])->count();')
[ "$demo" = "0" ] || fail "demo driver accounts exist ($demo) — a seeder ran against this database"
users=$(tinker 'echo DB::table("users")->count();')
ok "0 demo accounts; users table has $users row(s)"

echo
echo "SMOKE OK — $pass checks passed. Restore took ${secs}s. GET / on the API host → $root_code."
