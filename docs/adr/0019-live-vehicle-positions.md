# ADR-0019: Live vehicle positions

**Status:** Accepted (7 August 2026)

**Narrows:** ADR-0003's "Live tracking reads latest positions from Redis,
never MySQL" — see §3.

## Context

ADR-0003's ingestion path is built: pings are validated on the request,
buffered on the queue, and batch-inserted into `trip_locations`, which is
partitioned by month. What was never built is the read at the other end.
`Modules/Trips/README.md` said it in four words: **"There is no live map."**

Answering "where is UAA 123B right now" meant ordering `trip_locations` by
`recorded_at` for that trip and taking the last row — an index dive into the
table expected to reach ~500M rows a year, repeated per vehicle, every few
seconds, for every dispatcher with a map open. PROJECT.md asks for live
position freshness under 15 seconds and 200 concurrent dashboard users; that
query shape does not survive either number.

`Modules/Dispatch/README.md` also depends on this: automatic dispatch's
distance half is blocked on live positions existing at all.

## Decision

### 1. A snapshot table, separate from the history

`live_positions` holds **one row per vehicle**, overwritten on every ping.
`vehicle_id` is the primary key — the upsert is the entire access pattern,
and a surrogate key would add an index to maintain on every write for a row
nobody addresses any other way.

At 2,000 vehicles this is 2,000 hot rows that stay in the buffer pool. The
history stays in `trip_locations`, untouched, because it is evidence: it
backs billed distance and the odometer reconciliation.

### 2. Newest-wins, enforced in the statement

A device that loses signal sends its backlog **oldest-first** when it
reconnects. An unguarded upsert would walk every marker back through a route
the vehicle had already driven.

So the write is a hand-rolled `INSERT … ON DUPLICATE KEY UPDATE` where every
column is written only if `recorded_at` is newer than the stored value. The
first attempt did an unguarded upsert followed by a "repair" pass, which
cannot work: once the overwrite lands, the newer position it replaced is
gone.

Two implementation notes, both learned by failing:

- The statement uses `VALUES(col)`, not MySQL 8's `AS new` row alias.
  AGENTS.md names MySQL 8, but **the database this actually runs against is
  MariaDB 10.4**, which rejects the alias form outright. `VALUES()` is
  deprecated in MySQL 8.0.20 and still works, so it is the one spelling
  valid on both. Any future MySQL-8-only syntax will fail here the same way.
- A batch can hold several pings for one vehicle, so it is reduced to the
  newest per vehicle before the statement runs; otherwise the result would
  depend on row order inside the INSERT.

### 3. Two drivers, and the database one is the default

ADR-0003 says live tracking reads "from Redis, never MySQL". The requirement
underneath that sentence is what this ADR honours: answer in milliseconds,
never touch the history table, stay fresh. `LivePositionStore` is an
interface with two implementations:

- **`RedisLivePositionStore`** — a hash per vehicle with a TTL, plus a set
  of reporting vehicles so "the whole fleet" is one round trip rather than a
  `KEYS` scan. This is what ADR-0003 intended and what production should
  run.
- **`DatabaseLivePositionStore`** — the snapshot table above.

**The default is `database`, and that is a deliberate, uncomfortable
choice.** There is no Redis server, no phpredis extension and no predis
package in this repository's environment, and no Docker or WSL to stand one
up. The Redis driver is therefore **written but never executed** — its tests
would need a server to be meaningful. Defaulting to an unrun code path is
shipping a guess, so the driver that is exercised by 10 passing tests is the
one that ships on.

Switching is one line in `.env`. The interface exists precisely so that the
switch is a config change and not a code change, and so that a caller can
never accidentally depend on either.

### 4. Visibility is resolved through trips, never through positions

A position is only meaningful as "this vehicle, on this trip", and a trip
already knows whose it is. So `GET /api/v1/live-positions` asks which trips
the caller may see — `Trip::forActor($user)` plus the `trips.view.all`
predicate, exactly as `TripController::index` does — and the positions
follow from the vehicles on them.

Filtering `live_positions.tenant_id` directly would have been a second copy
of that predicate, and when two copies drift the symptom is a client
watching another client's van move across a map: the worst-shaped bug this
platform can have (ADR-0001).

Two narrower rules follow:

- Only trips in an **occupying** status are included. A vehicle whose trip
  finished yesterday still has a row; showing it would put a marker on a van
  sitting in the yard and a dispatcher would route work to it.
- The stored `trip_id` is checked against the visible set, because a vehicle
  reassigned to a new trip keeps one row. Without it, somebody who may see
  the vehicle's *previous* trip would read its current one.

### 5. The history is written first, and a live-store failure is swallowed

`TripRouteRecorder` inserts into `trip_locations`, then updates the
snapshot, and catches everything the second step throws.

The ordering is the point. The route is evidence; the snapshot is a
convenience. If a Redis outage could fail a ping batch, the job's retry
would duplicate a stretch of route into the table billing reads from — a map
one refresh out of date is a far smaller problem than a billing dispute.

### 6. Age is reported, not just position

Every entry carries `age_seconds` (from the **device** clock, not storage
time) and a `stale` boolean. A marker sitting still is ambiguous until you
know whether it is a parked vehicle or a dead phone, and a map that showed
storage time would hide exactly the ingestion lag AGENTS.md wants alerted
on.

`stale` is computed server-side against `tracking.live_stale_after_seconds`
so the threshold cannot live in two places that disagree. It defaults to 60
seconds rather than PROJECT.md's 15: 15 is the target for the *pipeline*,
and a marker flashing stale every time a driver passes under a flyover
trains dispatchers to ignore the flag.

## Consequences

The live map has a backend. `GET /api/v1/live-positions` answers in one
indexed read per request with no contact with `trip_locations`, correctly
scoped, with freshness attached. Automatic dispatch's distance input now has
a source.

`age_seconds` had a sign error in its first version — `diffInSeconds`
already returns a positive number for a past instant, and negating it made
every position report an age of zero. A stale marker that swore it was fresh
is the one lie this field exists to prevent, so it is now computed from raw
timestamps where the direction cannot be misread, and a test asserts a
five-minute-old position reads as stale.

## What remains deferred, and honestly

**Redis stream ingestion — `XADD`, consumer groups, replay after a crashed
worker — is still not built.** This ADR delivers the *read* half of
ADR-0003's live tracking; the *write* half still buffers on Laravel's queue,
which is Redis-backed in production via `QUEUE_CONNECTION=redis` but is not
a stream and gives none of a consumer group's guarantees. Building a stream
worker that has never once been run against a real Redis would be worse than
not building it: the failure modes it exists to handle — a worker dying
mid-batch, a consumer group rebalancing — are precisely the ones that cannot
be reasoned into correctness without exercising them.

That work needs Redis in the development environment first. It is a
prerequisite, not an excuse, and it is the next thing to do here.

Also unbuilt: the frontend map itself (this ADR is the API it will call),
and pruning of `live_positions` rows for vehicles long out of service, which
the Redis driver gets free from its TTL.

## Alternatives considered

**Reading the last row of `trip_locations`.** The status quo, and the reason
for this ADR — a 500M-row table is not a lookup table.

**Redis only, defaulting to it.** Rejected in §3: an unexecuted code path is
not a default.

**A `latest_ping_id` column on `trips`.** Cheaper to write, but reading it
still means fetching that row from `trip_locations`, so it moves the index
dive rather than removing it.

**Broadcasting positions over Reverb instead of polling.** Genuinely better
for a live map and explicitly not this ADR: the platform has no broadcasting
in use yet, and a push channel needs an authoritative snapshot to send —
which is this.
