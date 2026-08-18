# KangaruRide

Enterprise Transport Management & Fleet Operations Platform. Modernizes corporate
fleet operations — booking, dispatch, trip lifecycle, GPS tracking, odometer
capture, rate-card billing, reporting and audit — for corporate clients, banks,
NGOs, government agencies and fleet owners. See [PROJECT.md](PROJECT.md) for the
full product brief, [AGENTS.md](AGENTS.md) for engineering standards, and
[DESIGN.md](DESIGN.md) for the brand/design token spec.

## Repository layout

| Path | What it is |
|---|---|
| `AGENTS.md`, `PROJECT.md`, `DESIGN.md` | Governing docs — read these first |
| `docs/adr/` | Architecture Decision Records |
| `backend/` | Laravel 12 API (`Modules/` feature structure — see `backend/README.md`) |
| `frontend/` | Vite + React + TypeScript SPA (see `frontend/README.md`) |
| `KangaruRide Design System/` | Source-of-truth component library and design tokens — not npm-packaged; ported piecemeal into `frontend/src/components` and `frontend/src/styles/tokens` |
| `material/` | Brand and logo image assets |

## Local development prerequisites

- PHP 8.3+ (production target is PHP 8.4 per AGENTS.md — this machine currently
  has 8.3.32; revisit before deploying)
- Composer 2.x
- Node 20+ and npm
- MySQL 8 (production target) or MariaDB 10.4+ (what's available locally via
  XAMPP) — both work for this stage; watch for MySQL-8-only features later
- Redis is **not** required for local development yet. It becomes necessary
  when GPS ingestion work starts (see `docs/adr/0003-gps-ingestion-path.md`);
  until then `backend/.env` uses the `database` driver for cache/queue/session.

## Running locally

Backend (from `backend/`):

```bash
composer install
cp .env.example .env    # if not already present
php artisan key:generate
php artisan migrate --seed
php artisan serve       # http://127.0.0.1:8000
```

**And, in a second terminal, a queue worker — this is not optional:**

```bash
php artisan queue:work
```

`QUEUE_CONNECTION=database`, and several things that look like plain
request/response features are actually queued jobs. Without a worker they
queue silently, forever, with **no error anywhere**:

| Job | What silently stops |
|---|---|
| `RecordTripLocations` | GPS pings never reach `trip_locations` — so route replay is empty, `gps_distance_km` stays null, and **odometer readings are never reconciled against GPS** |
| `TripOfferedNotification` | drivers are never pushed job offers |

This has already cost real debugging time once. Because the API answers
**202 Accepted** for a ping batch, every layer looks healthy: the app uploads
fine, the server accepts, nothing errors, and the evidence simply never
appears. A single mistyped odometer digit then reached the driver ledger as a
UGX 198,013,800 fare, because the check that exists to catch exactly that had
never run. See `docs/distance-and-fare-integrity-plan.md`.

If GPS traces or offers seem missing, check the queue **first**:

```bash
php artisan tinker --execute="echo DB::table('jobs')->count();"
```

Anything above zero and climbing means no worker is running.

**For a physical handset**, the driver app also needs the API on the machine's
LAN address rather than loopback — see `mobile/.env`:

```bash
php artisan serve --host=0.0.0.0 --port=8000
```

Frontend (from `frontend/`):

```bash
npm install
cp .env.example .env
npm run dev              # http://localhost:5173
```

Do not point XAMPP's Apache at `backend/` directly — it would serve `.env` and
`vendor/` over HTTP. Use `php artisan serve`, or if Apache is required later,
point its vhost `DocumentRoot` at `backend/public` specifically.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `main`:

- **Commit messages**: commitlint (Conventional Commits, `commitlint.config.cjs`).
- **Secret scanning**: gitleaks over the repository history.
- **Backend**: Pint (zero tolerance), Larastan level 8, migration
  reversibility (`migrate` → `migrate:rollback` → `migrate`), Pest with a
  70% overall coverage floor and 90% on `Modules/Billing` and
  `Modules/Dispatch`. Runs against PHP 8.4 / MySQL 8 — the production
  target per AGENTS.md — even though local dev currently runs PHP 8.3 /
  MariaDB via XAMPP.
- **Frontend**: ESLint, `tsc --noEmit`, Vitest component tests, production
  build.

`.github/workflows/audit.yml` runs `composer audit` and `npm audit` weekly.

Frontend tests run with `npm run test` (`test:watch` while working,
`test:coverage` for a report). They cover the two critical flows AGENTS.md
names by hand — the booking form and the dispatch board — plus the credit
note dialog.

Still not enforced in CI (flagged, not forgotten):

- **A frontend coverage gate.** Three test files do not yet justify a
  number, and a threshold set to whatever today happens to measure ratchets
  on noise. `npm run test:coverage` reports; nothing fails on it.
- **Shared component tests.** AGENTS.md asks for these alongside the
  critical flows; `src/components/` has none yet.
- **Branch protection on `main`.** `CODEOWNERS` exists but is advisory
  until "Require review from Code Owners" is enabled on the repository.
