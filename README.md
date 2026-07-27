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

Frontend (from `frontend/`):

```bash
npm install
cp .env.example .env
npm run dev              # http://localhost:5173
```

Do not point XAMPP's Apache at `backend/` directly — it would serve `.env` and
`vendor/` over HTTP. Use `php artisan serve`, or if Apache is required later,
point its vhost `DocumentRoot` at `backend/public` specifically.
