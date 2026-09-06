# ADR-0038: Duty sessions, and online hours becoming measurable

**Status:** accepted
**Date:** 2026-08-15
**Supersedes:** the "one row per driver, overwritten" half of ADR-0024 §2 — as
a *storage* decision only. Everything that decision was protecting is
preserved; see Decision.
**Related:** ADR-0017 (rosters), ADR-0034 §4 (the weekly bonus target this
screen's card reports against)

## Context

The Performance screen asks a driver six questions about their own work. Five
of them the platform could already answer. The sixth — **how long was I
online** — it could not, and the reason was written down twice, deliberately,
by people who had thought about it:

`create_driver_presence_table` says a presence history "would be a second
500M-row table answering a question nobody has". `mobile/src/earnings/
presentation.ts` says the same thing in prose to whoever next reads the
earnings screen: `on_trip_minutes` is time *driving*, "and time spent waiting
for an offer is not in it and cannot be — `driver_presence` keeps no history."

Both statements were correct. `driver_presence` is one row per driver,
overwritten in place, and `setDuty(false)` nulls the position columns on the
way out. There is no `on_duty` timestamp anywhere, so "how long was I online"
had no rows to count.

Three near-misses were considered and rejected before this was written:

- **`on_trip_minutes`** is a strictly smaller thing. A driver who sat at a
  stage for four hours and drove for one made themselves available for five;
  reporting one would tell them their morning did not happen.
- **`dispatch_offers.offered_at`** shows the platform *thought* they were
  online, but only at the instants it happened to have work — a quiet Tuesday
  looks identical to being signed off.
- **Inferring from `trip_locations`**, which is real history, has the same
  hole: it starts at Trip Started (ADR-0003) and says nothing about waiting.

The question is a real one. A driver whose acceptance rate has fallen wants to
know whether they were online less or declining more, and a fleet office
asking a driver to work more hours should be quoting a figure rather than an
impression.

## Decision

**A duty session is a row.** `driver_duty_sessions` records one interval per
shift: `started_at`, `ended_at`, and the vehicle it was worked with.

**This does not reinstate a position history, and the distinction is the whole
of why ADR-0024 §2's objection does not apply.** That objection was about
*telemetry* — a row per heartbeat, per driver, forever, which is where the
500M-row estimate comes from and which would have answered "where was this
driver at 11:04". This table takes **two rows per driver per day**: one when
they sign on, one when they sign off. A thousand drivers working every day
produce under a million rows a year, and the row holds no coordinates at all.
The privacy property ADR-0024 §2 was protecting — that where somebody was when
they signed off is usually where they live — is untouched, because this table
has no latitude and no longitude.

`driver_presence` keeps its job unchanged: it is the live snapshot dispatch
ranks against, and nothing about its shape, its TTL or its clearing behaviour
moves.

### Where a session opens and closes

- **Opens** at `PUT /me/duty` with `on_duty: true`, beside the existing
  `setDuty()` call. Idempotent: a driver whose request times out and retries
  has one shift, not two — the same property that route already promises.
- **Closes** at `PUT /me/duty` with `on_duty: false`.
- **Closes on staleness**, at the last heartbeat, when no heartbeat has
  arrived for longer than `dispatch.presence_ttl_seconds`.

That third rule is the one that makes the figure honest rather than
flattering. A shift that only ever ended when a driver remembered to press a
button would report a phone left in a drawer as a fourteen-hour day. **The TTL
is reused rather than given its own setting on purpose:** it is already the
line at which dispatch stops offering this driver work, and a driver the
platform will not send a job to was not online. Two settings would eventually
disagree, and the disagreement would show up as a driver being paid attention
for hours in which nobody could reach them.

### The exception that the rule needs

**A driver on a live trip is never swept, and the sweep refreshes their
session instead.** The heartbeat is a JavaScript `setInterval` in
`PresenceController`, and it stops when the handset backgrounds the app —
which is exactly what happens when a driver puts the phone in a cradle and
drives. Without this exception a two-hour journey would report as three
minutes online, and the sweep would sign the driver off mid-passenger.

Being on a trip is the most on-duty a driver can be. `DriverPresenceController
::refusalToStartShift()` already reached this conclusion for a different
question and records what it cost to learn.

### `last_seen_at` lives on the session

Rather than reading `driver_presence.recorded_at` at sweep time. Two reasons,
either sufficient:

1. **`setDuty(false)` nulls `recorded_at`.** The last known heartbeat is
   destroyed at precisely the moment a closing session would want it.
2. **The presence store is swappable.** `DriverPresenceStore` has a Redis
   implementation for environments that have Redis; history must survive
   either choice, and a history that depends on which cache is configured is
   not history.

The cost is one indexed `UPDATE` per heartbeat — the same order as the
presence write already happening on that request, and no extra round trip.

## Consequences

**A driver can be told how long they were online, and it is measured.** The
Performance screen draws it against their *rostered* hours from
`driver_shift_windows`, which is a real denominator rather than an invented
one — and draws no arc at all for a driver with no roster, because ADR-0017 §3
makes an empty roster mean "available at any hour", which is not a number.

**The figure is conservative, and should be.** It counts time the platform
could actually reach the driver. A driver in a dead zone for twenty minutes
loses those twenty minutes. That is the right direction for the error to run:
this figure will eventually be quoted at somebody in a conversation about
their hours, and a number that overstates availability is one the driver
cannot argue against.

**The sweep is a new scheduled command**, `duty:close-stale`, every minute.
Its absence does not corrupt anything — an open session is simply still open —
so a missed cron degrades the figure rather than breaking it.

**What is deliberately not built:** no console screen showing who is on duty
and for how long. That is a fleet-office feature and a real one; this ADR
gives it its table. No `ended_reason` analytics, no shift-vs-roster variance
report, and no notification to a driver left on duty overnight.
