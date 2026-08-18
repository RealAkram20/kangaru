# ADR-0024: Walk-in fulfilment and offer-based dispatch

**Status:** Accepted (9 August 2026)

**Depends on:** ADR-0012 (walk-in order requests, which deferred fulfilment
"to its own ADR" — this is it), ADR-0013 (the customer principal),
ADR-0005 (the fleet and the walk-in customer belong to the platform),
ADR-0016 (drivers can sign in), ADR-0017 (availability), ADR-0019 (live
vehicle positions), ADR-0020 (the matcher), ADR-0022 (per-client token
scope), ADR-0023 (the offline outbox).

**Superseded within:** ADR-0020's "Auto-dispatching on a schedule" —
recorded there as deliberately not done — is done here, for walk-ins only
and behind its own flag. Corporate bookings are untouched: a human still
presses the button.

## Context

The platform can take an order from the public and it can rank a fleet, and
there is nothing between the two. `POST /public/order-requests` writes a row
and notifies the desk; `OrderRequestStatus::CONVERTED` records that somebody
phoned the caller back, and says in its own docblock that it "does not link
to a Trip or Booking". Everything downstream of the form is a telephone.

`frontend/src/pages/public/ride.ts` names the gap precisely, because the
customer's screens were built against a simulation and its author wrote down
what the simulation was standing in for:

> The backend work this waits on, in dependency order: the driver becomes an
> authenticated principal; walk-in trips get an owner that is not a tenant;
> driver presence and position land in Redis; matching offers a ride and
> takes an accept under the same pessimistic lock dispatch already uses.

The first is done (ADR-0016). This ADR is the other three.

Four things were found to be missing only once the chain was traced end to
end, and each of them is a decision rather than a task:

1. **A walk-in trip has nowhere to live.** `trips.tenant_id` is a
   non-nullable foreign key. Every trip in this system is a corporate
   client's.
2. **The matcher cannot see idle drivers.** `DispatchRecommender` ranks by
   `live_positions`, whose only writer is `TripRouteRecorder` — fed by trip
   GPS, which the driver app streams only from `trip_started`
   (`shouldStreamGps`). A driver sitting at a stage waiting for work reports
   nothing at all, so "the nearest driver" is a question with no data behind
   it.
3. **There is no offer.** `DispatchService::assign` writes a Trip. The
   driver's accept is a *transition on a trip that already exists and is
   already holding their vehicle*, and their decline leaves a `rejected`
   trip for a human to reassign. Nothing times out, and nothing moves on to
   the next driver.
4. **Neither party can reach the other.** The driver's app is never told who
   the passenger is; the customer's screen gets its captain, phone number
   included, from `simulatedRideSource`.

## Decision

### 1. A walk-in trip is owned by a customer, not by a tenant

`trips.tenant_id` becomes **nullable** and `trips.customer_id` is added,
nullable, referencing `customers`. **Never both**, and a walk-in is a trip
with no tenant.

An earlier draft of this section said "exactly one of the two is set". That
was wrong, and running the flow end to end is what showed it: `POST
/public/order-requests` is unauthenticated (ADR-0012 §3) and links to an
account only when a customer token happens to accompany it (ADR-0013 §4), so
an **anonymous order produces a trip with neither owner** — no client, and no
account either. Those are walk-ins by every meaningful test: a contact name
and number sit on the order request, and somebody is standing at a kerb.

`Trip::isWalkIn()` therefore asks `tenant_id === null` rather than
`customer_id !== null`. It was written the second way first, and the visible
symptom was the driver's call button never appearing on an anonymous ride —
§7's contact rules ask that question before anything else.

That invariant is enforced in `TripService`, which is already the only
writer, and **not** as a database CHECK constraint — following the precedent
the `customers` migration set for its own two-nullable-credentials rule: an
invariant belongs "where it is readable, not as a CHECK constraint MySQL
would bury in a schema dump". The guarantee that actually matters here is
not the constraint anyway; it is the cross-tenant isolation suite, which is
mandatory and non-skippable, and which is extended in both directions
(Consequences).

The alternative — a "walk-in" pseudo-tenant row that every walk-in trip
points at — was rejected for the reason ADR-0012 rejected it for
`order_requests`: a fake tenant is visible to every screen, every report and
every scope in the system, and each of them then needs to know to exclude it
forever. The nullable column is honest. There is no tenant; the column says
so.

This is the same shape as the fleet's own move (ADR-0005) and as
`order_requests`, `customers` and `drivers` before it: **platform-owned rows
carry a null tenant.** `TenantScope` fails closed, so a walk-in trip is
invisible to every corporate client by construction rather than by a
predicate somebody has to remember to write. Platform staff reach it through
`forActor()`, which already drops the scope for an actor with no tenant, and
a driver account is such an actor — so the driver's app sees a walk-in trip
assigned to it with no change to `TripController::index`.

`bookings` is deliberately **not** given the same treatment. A walk-in does
not produce a booking. `Booking` carries `tenant_id`, `client_id`,
`requested_by_user_id` and an approval workflow that exists because a
corporate client's staff raise requests their own administrator approves;
none of that has a meaning for a stranger on the internet. `Trip.booking_id`
has been nullable since it was added — "null on an ad-hoc trip raised
without a booking" — and a walk-in trip is exactly that.

### 2. Presence is its own subsystem, and it is not `live_positions`

`live_positions` answers *"where is this vehicle"*, is keyed by vehicle, and
is written by the GPS pipeline. Overloading it to also mean "this driver is
on duty and wants work" would conflate three different facts with three
different lifetimes, and would make the map's freshness contract
(<15 s, ADR-0019) the dispatch radius' contract too.

So: **`DriverPresence`**, keyed by driver, behind the same interface-with-two-
implementations pattern `LivePositionStore` established (Redis where there is
one, the database where there is not). It records duty state, the vehicle the
driver is on shift with, their last position, and when it was taken.

Two new driver-scoped endpoints:

- `PUT /me/duty` — go on or off duty. An explicit act, not inferred from the
  app being open. A driver who leaves the app running in their pocket at home
  is not available, and a system that decides otherwise sends offers into a
  void and then reports its own matcher as slow.
- `POST /me/presence` — a position heartbeat, at a deliberately slower
  cadence than trip GPS. Trip GPS is billing evidence and is sampled for a
  route; this is a dispatch radius and is sampled for a ranking. Running the
  fine-grained one all day to answer a coarse question is how a driver's
  battery dies before lunch, and a driver whose battery died is a driver who
  is off duty for the rest of the shift whatever the database thinks.

**Presence goes stale rather than being trusted forever.** A record older
than `dispatch.presence_ttl_seconds` is treated as absent — not as
"available at the last known place". The failure mode of the alternative is
that a phone that lost signal at 07:00 keeps winning the ranking all
morning, and every order routed to it times out.

Presence is **not** availability. `AvailabilityService` still answers rosters,
leave, status and conflicting trips, and it still answers first: a driver on
approved leave who opens the app and goes on duty is refused by the same code
that refuses a dispatcher who tries to assign them. Presence narrows a set
that availability has already decided.

### 3. Dispatch offers a ride; the Trip is born on the accept

A new `dispatch_offers` table. An offer references the order request, a
driver, a vehicle, its rank in the wave, and when it expires.

**Nothing is written to `trips` until a driver accepts.** This is the whole
point of the change, and it is a correctness decision rather than a modelling
preference:

- A trip in `assigned` **occupies its vehicle** (`TripStatus::occupiesVehicle`).
  Creating one to represent an unanswered offer would take a real vehicle out
  of the fleet for as long as a driver ignored their phone, and offering the
  same job to a second driver would need a second trip on the same vehicle —
  which `TripAssignmentGuard` correctly refuses.
- A declined offer would otherwise leave a `rejected` trip carrying an
  odometer, an events timeline and a place in the billing lifecycle, for a
  journey that never had a driver. `trip_events` is evidence; it should not
  be full of trips nobody drove.

The accept path runs inside a transaction and calls **`TripService::create`,
which calls `TripAssignmentGuard`** — the same pessimistic lock every other
assignment path takes. It then moves the trip to `accepted` through
`TripStateMachine`, in the same transaction: the driver has already said yes,
and a trip left in `assigned` asks them to say it again. The first
implementation omitted that line and produced exactly that double-accept —
along with a call button that never appeared, because §7 withholds the
passenger's number until `accepted`. One missing transition, two symptoms. There is still exactly one way a vehicle and driver
get onto a trip, which was already the rule and is the reason the guard's
docblock enumerates its callers.

Two drivers accepting the same order race in the database, and the loser gets
a 409 naming the reason. The offer they hold is marked `superseded`, and the
app says the job was taken rather than showing a failure.

### 4. Sequential waves, and the wave size is configuration

An order is offered to the top-ranked candidate, alone, for
`dispatch.offer_ttl_seconds`. On decline or expiry it goes to the next.

Broadcast-to-everyone was rejected as the default. It produces one winner and
N−1 drivers who dropped what they were doing for nothing, which is how a
fleet learns to ignore offers; and it turns every dispatch into a contended
write on the same rows. But it is genuinely better on a thin night when the
nearest driver is eleven minutes away, so the wave size is
`dispatch.offer_wave_size` (default 1) and widening it is a setting rather
than a rewrite. The code offers *a wave*; the wave happens to be one driver.

`dispatch.offer_max_rounds` bounds the search. When it is exhausted, the
order is **not** silently dropped: it goes to `unmatched`, which returns it to
the human queue that ADR-0012 built and that a dispatcher is already watching
— and which `RideScreen` already renders as a phase. A matcher that gives up
loudly is one an operator can trust; a matcher that gives up quietly is one
they stop using.

### 5. Expiry is a clock, not a job

An offer expires because `expires_at` has passed, and every read evaluates
that. A scheduled command (`dispatch:advance-offers`) exists and moves the
search along, but it is an **accelerator, not the mechanism**.

This is deliberate and it is the lesson of `KangaruNotification::viaConnections()`,
which pins the in-app row to the `sync` connection because a queue worker was
not running and an approved booking left the approver's own bell unchanged.
A dispatch system whose offers only expire when a worker happens to be alive
is a dispatch system that wedges when the worker dies — with an order held by
a driver who went home, and no way to tell.

So the invariant is: **an expired offer is expired whether or not anything
ran.** The command exists because somebody has to notice and offer the job to
the next driver, and a customer watching a screen should not have to poll to
make that happen.

### 6. Dispatch runs on arrival, unattended, behind its own flag

`OrderRequestReceived` already exists as a moment in `OrderRequestService::receive`
— it notifies the desk. Walk-in dispatch hangs off the same moment.

`dispatch.walk_in_auto_dispatch`, **on by default**, which is the opposite of
ADR-0020's `automatic_enabled` and needs its justification stated rather than
assumed. ADR-0020's flag is off because it changes how *corporate bookings*
are dispatched — an existing, working, human-operated flow, on accounts with
commercial agreements behind them, where a matcher acting unattended is a new
risk taken on somebody's behalf. This flag governs a flow that **does not
exist yet**: a walk-in order today reaches a telephone. Off by default would
ship a feature switched off, and its failure mode is the status quo the desk
is already staffed for.

The two flags are separate for that reason, and neither is read by the other.

### 7. Each party gets one number, for as long as the trip is live

A `ContactChannel` abstraction returns a dialable number and a label for a
party on a trip. `DirectContactChannel` — today's implementation — returns
the real number. A masking implementation (Twilio, Africa's Talking) is a
second class behind the same interface, and the seam exists now precisely so
that adopting one is not a schema change.

Three rules, all enforced server-side in the resource layer rather than in a
client:

- **The driver sees the passenger** only on a trip assigned to them, and only
  while it is live — from `accepted` to `trip_completed`. Not before they
  accept: an offer carries a pickup and a distance, and a phone number handed
  to a driver who then declines is a phone number given away for nothing.
- **The customer sees the captain** only once one is assigned, and only for
  their own trip, resolved through the customer guard's own scope.
- **Both numbers disappear at a terminal status.** A completed trip is not a
  directory.

Corporate bookings are unchanged and deliberately so: a client's passenger
is the client's business, their contact details are in the client's own
system, and this ADR is not the place to start exposing them.

## Consequences

The chain closes: a stranger orders on the website, the platform ranks the
fleet against where drivers actually are, offers the job to the best one,
takes their accept under the lock that already guarantees no double
assignment, creates the trip, and puts each party one tap from the other.
`Modules/Bookings/README.md`'s walk-in fulfilment deferral and
`ride.ts`'s four-item dependency list are both closed by this.

**`trips.tenant_id` becoming nullable is the riskiest edit in the change**,
because ADR-0001's isolation guarantee is the one bug this platform cannot
ship. It is covered by extending the mandatory cross-tenant suite in both
directions — that a client cannot see a walk-in trip, and that a customer
cannot see a client's — and by asserting the one-owner invariant at the
database, not only in the service that writes it.

**Billing has a customer-owned trip it has never seen.** `invoices` are
tenant-owned; a walk-in's fare is not an invoice to a corporate account. The
fare shown at the end of a walk-in ride is computed from the rate card and
**not** written to the ledger, and nothing about corporate invoicing changes.
Walk-in settlement — cash, mobile money, a receipt — is real work and is
deferred with that name on it, in `Modules/Billing/README.md`.

**Presence adds a write path a driver's phone runs all day.** It is coarse on
purpose (§2), it stops when the driver goes off duty, and it stops when the
app is backgrounded for longer than the TTL — at which point the driver is
treated as absent, which is the safe direction.

**A declined offer is a fact about a driver.** `dispatch_offers` records who
was offered what and what they did, which is the acceptance-rate data
`Modules/Drivers/README.md` lists as missing. Nothing aggregates it yet, and
nothing here decides what a low rate should mean — that is an operations
policy, and encoding a guess as policy is the trap that README already names
for hours-of-service.

## What this deliberately does not do

**It does not change corporate dispatch.** `POST /bookings/{id}/assignment`
and `POST /bookings/{id}/auto-assignment` behave exactly as they did, on the
same flag, with the same tests passing unchanged. A dispatcher's screen is
not touched.

**It does not add road distance or a real ETA.** Ranking is still
straight-line (ADR-0020 §3), and the customer's screen shows an estimate
labelled as one. Promising an arrival time needs the Directions API and a
model of Kampala traffic, and a number that is confidently wrong is worse
than a range.

**It does not price the walk-in ride into the ledger.** See Consequences.

**It does not do scheduled walk-ins.** An order with a `scheduled_for` in the
future is not offered now; it stays in the desk's queue. Holding an offer
open for six hours, or waking a matcher at 05:00 to find a driver for a 06:00
pickup, is a scheduler with its own failure modes and its own decisions about
how early to start looking.

**It does not let a customer cancel from the ride screen.** The button is
rendered by the simulation today and the endpoint behind it is real work —
cancellation has a charge rule (`cancellation_charge_applicable`), and who
pays what when a customer cancels ninety seconds before pickup is a
commercial decision nobody has made.

## Alternatives considered

**A pseudo-tenant for walk-ins.** Rejected in §1, for the reason ADR-0012
rejected it: a fake row that every future screen must learn to hide.

**Reusing `live_positions` for presence.** Rejected in §2. One table, three
lifetimes, and the map's freshness contract silently becomes the dispatch
radius' contract.

**Creating the Trip on offer and deleting it on decline.** Rejected in §3.
It occupies a real vehicle for an unanswered phone, it cannot express a
second offer, and it fills the evidence table with journeys nobody drove.

**Broadcasting every offer to every nearby driver.** Rejected as the default
in §4, and available as `offer_wave_size`.

**Driving expiry purely from a queued job.** Rejected in §5 — it makes
correctness depend on a process this deployment has already been observed
not to be running.

**Number masking as a prerequisite.** Rejected: it blocks the entire feature
on procuring a paid telephony account, to solve a problem the operator does
not have yet at a scale they have not reached. The seam is built (§7); the
implementation is one class when it is wanted.