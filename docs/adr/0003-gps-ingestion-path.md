# 0003. GPS Ingestion Path

**Status:** Accepted

## Context

At target scale (2,000 vehicles pinging every 10 seconds) GPS ingestion is
~200 writes/second, and `trip_locations` grows by roughly 500M rows/year.
Writing every ping straight to MySQL from the request path would strain the
primary database and isn't necessary for live tracking, which only needs the
latest position per vehicle.

## Decision

- GPS pings enter via API → validated → pushed to a Redis stream →
  batch-inserted by a queue worker into a dedicated `trip_locations` table
  partitioned by month.
- Live tracking reads latest positions from Redis, never MySQL.
- MySQL holds historical routes for replay and billing distance
  verification.
- Retention: raw pings 12 months, then downsampled polylines only.

## Consequences

Live tracking stays fast and cheap regardless of MySQL load. Redis becomes a
hard dependency the moment this module is built — not required for the
Phase 1 scaffolding pass that precedes it (see root `README.md`). Monthly
partitioning and 12-month retention keep `trip_locations` from growing
unbounded; partitions older than 12 months are archived to Cloudflare R2 as
compressed exports.

## Alternatives considered

- **Direct MySQL writes on every ping** — rejected: ~200 writes/second of
  small inserts on the primary database competes with transactional traffic
  (bookings, dispatch, billing) for no benefit, since live tracking only
  needs the latest position.
- **Time-series database (e.g. InfluxDB) instead of MySQL** — rejected for
  Phase 1: adds a new operational dependency; MySQL with monthly partitioning
  is sufficient at target scale and keeps the stack smaller for a
  single-developer team.
