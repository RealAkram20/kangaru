# Deploying KangaruRide on Coolify

The stack, how to stand it up in a blank Coolify project, how to know it is
actually running, and how to back it up, restore it and roll it back.
Written by W1-a; W1-d's `docs/runbook.md` lifts from here and adds the alert
set and the on-call answer.

**Owner decisions this implements** (`docs/master-plan.md` §1): a blank,
fully isolated Coolify project — this project's own MySQL 8, own Redis, own
volumes, resource limits on every container. Nothing shared with a
neighbour.

---

## 1 · What runs

`docker-compose.yml` at the repo root. Seven containers:

| Service | Image | Does | Reached by |
|---|---|---|---|
| `app` | `backend/Dockerfile` (nginx + php-fpm, PHP 8.4) | the API; runs the **release step** on start | Coolify proxy → port 8080 · domain `api.…` |
| `queue` | same image | `queue:work` — GPS batch-insert (ADR-0003), notifications, report exports | nothing |
| `scheduler` | same image | `schedule:work` — `dispatch:advance-offers` **every 10 s**, `duty:close-stale` every minute, the nightly/weekly jobs | nothing |
| `mysql` | `mysql:8.0` | the database, dedicated; binlog off | internal network only |
| `redis` | `redis:7-alpine` | live positions, presence, cache, scheduler locks; `noeviction` | internal network only |
| `web` | `frontend/Dockerfile` (static nginx) | the SPA — console and public site | Coolify proxy → port 80 · domain `www.…` / apex |
| `backup` | `mysql:8.0` + `deploy/backup.sh` | nightly `mysqldump` to the `backups` volume, 14 days kept; hosts `restore.sh` | nothing |

**Only `app` and `web` are routable, and only through the proxy.** No
service publishes a host port. MySQL and Redis cannot be reached from the
host or from another Coolify project.

Volumes: `app-storage` (driver documents — ADR-0033 — odometer photos,
branding uploads, report exports), `mysql-data`, `redis-data`, `backups`.
All survive redeploys. **The nightly dump covers MySQL only; back
`app-storage` up at the host as well.**

The release step (`backend/docker/entrypoint.d/50-kangaruride-release.sh`)
runs in `app` only: `migrate --force`, `storage:link`. **Never `--seed`, never
`db:seed`** — `DriverAppSeeder` creates a Super Admin whose TOTP secret is
committed to this repository (`backend/.env.production.example`, last
section). `queue` and `scheduler` wait for `app` to be healthy, so they never
run against an un-migrated schema. Every container caches its own config,
routes, events and views at start (`10-kangaruride-optimize.sh`).

---

## 2 · Standing it up in Coolify

1. **New project → new resource → Docker Compose**, source = this repository,
   branch `main`, compose location `/docker-compose.yml`. Coolify reads the
   file and lists every `${VAR}` it references as an environment variable.
2. **Environment.** Fill the keys. The application keys are exactly
   `backend/.env.production.example` — same names, same decided defaults;
   the compose file already supplies `DB_HOST=mysql`, `REDIS_HOST=redis`.
   Keys that exist only for the stack:

   | Key | What |
   |---|---|
   | `DB_ROOT_PASSWORD` | MySQL root — used by `restore.sh` only, never by the app |
   | `VITE_API_BASE_URL` | baked into the SPA at build: `https://api.<domain>/api/v1` |
   | `VITE_GOOGLE_MAPS_API_KEY`, `VITE_MAPBOX_TOKEN`, `VITE_GOOGLE_CLIENT_ID` | optional; `frontend/.env.example` explains each |
   | `BACKUP_UTC_TIME`, `BACKUP_KEEP_DAYS` | default `23:15` UTC (02:15 Kampala), 14 |
   | `APP_CPUS`/`APP_MEM`, `QUEUE_…`, `SCHEDULER_…`, `MYSQL_…`, `REDIS_…`, `WEB_…`, `BACKUP_…`, `MYSQL_BUFFER_POOL`, `MYSQL_MAX_CONNECTIONS`, `REDIS_MAXMEMORY` | resource limits; defaults in the compose file total ≈ 3.9 GB RAM / 4.25 CPU |

   `APP_KEY`: `php artisan key:generate --show` **once**, then never again —
   rotating it makes every encrypted driver document unreadable.
   Mark every password and `APP_KEY` as a secret in Coolify's UI.
3. **Domains.** In the resource's service list, give `app` the API domain
   (port 8080) and `web` the site domain (port 80). Coolify's proxy issues
   the certificates and terminates TLS; the containers speak plain HTTP.
4. **Deploy.** Watch the log: `app` prints `[release] migrate --force` …
   `[release] done`; `queue` and `scheduler` start after `app` is healthy.
5. **Prove it** — §3. Do not skip this; a default deploy that runs only
   `app` looks perfectly healthy.

---

## 3 · Is it actually running?

From the Coolify server, in the resource's directory (or via Coolify's
terminal on a container):

```sh
docker compose ps                                     # 7 services, all "running"/"healthy"
docker compose exec app php artisan schedule:list     # exactly 6 entries; advance-offers shows "10s"
docker compose exec scheduler pgrep -fa schedule:work # one process
docker compose exec queue pgrep -fa queue:work        # one process
docker compose exec app php artisan queue:monitor database:default
docker compose exec app php artisan about --only=drivers   # cache: redis, queue: database
```

Or run the whole check the CI job runs: `bash deploy/smoke.sh` with
`APP_URL`/`WEB_URL` pointed at the live domains and `COMPOSE_FILE` set — it
performs a backup, mutates, restores, and reports the restore time. **On
production this is a deliberate outage of the restore's duration**; do it
before clients are on, not after.

Silent failures to know by heart (`docs/master-plan.md` §3):

| Symptom | Missing |
|---|---|
| an offer nobody answers never moves to the next driver | `scheduler` |
| GPS never lands, notifications never send | `queue` |
| live map blank | `redis`, or `TRACKING_LIVE_POSITIONS_DRIVER` not `redis` |
| uploads vanish after a redeploy | `app-storage` volume not mounted |

---

## 4 · Backup and restore

- **Nightly** at `BACKUP_UTC_TIME`, plus one on every start of the `backup`
  container. Files: `/backups/kangaruride-<db>-<UTC>.sql.gz` on the
  `backups` volume. A dump that fails its gzip check or is under 1 KB is
  discarded, and retention runs only after a successful dump.
- **List:** `docker compose exec backup /opt/kangaruride/restore.sh --list`
- **Take one now:** `docker compose exec backup /opt/kangaruride/backup.sh --once`
- **Restore:**
  `docker compose exec backup /opt/kangaruride/restore.sh <file> --yes`
  Drops and recreates the database, loads the dump, prints
  `RESTORE_SECONDS=<n>`. Without `--yes` it prints what it would do and
  exits 3. **The API answers 500 for the duration.**
- **Rehearse it once before the first client data lands**, and write the
  number down. CI rehearses it on every run against a fresh schema (seconds);
  a real database will take longer, and only a real rehearsal says how much.
- **Copy dumps off the server.** The `backups` volume is on the same disk as
  the database it protects. Coolify's S3 backup destination or a nightly
  `docker cp` to another machine — the owner's choice, and not built here.

---

## 5 · Rollback

Coolify keeps every deployment. **Rollback = redeploy the previous
commit** from the resource's Deployments tab. The release step runs
`migrate` (never `migrate:rollback`), so:

- **Code-only rollback:** redeploy the previous commit. Under a minute plus
  image build. Safe.
- **A migration must come back out:** stop `queue` and `scheduler`, run
  `docker compose exec app php artisan migrate:rollback --step=1 --force`
  (every migration is reversible in CI — AGENTS.md), then redeploy the
  previous commit. If the migration was destructive, restore from the dump
  taken before the deploy instead (§4).
- **Take a backup before every deploy that carries a migration.**
  `backup.sh --once` takes seconds.

W1-d rehearses and times this on the live server; the number belongs in
`docs/runbook.md`.

---

## 6 · What CI proves, and what it does not

The `deploy-stack` job in `.github/workflows/ci.yml` builds both images from
this file on a GitHub runner, brings all seven containers up, and runs
`deploy/smoke.sh`: limits on 7/7 containers, no host ports on the five
internal services, `/up` 200, JSON error envelope, no exception bodies, the
SPA with deep-link fallback, `schedule:list` = 6 with the ten-second entry,
a queued job completed **by the queue container** through the dedicated
Redis, the shared storage volume, backup → mutate → **restore** timed, and
zero demo accounts.

It does **not** prove: the Coolify server, its proxy or its certificates;
real secrets; performance under load; that `app-storage` is backed up; or
that anyone has rehearsed the restore against a database with data in it.
Those are W2-a's and W1-d's, and the owner's.
