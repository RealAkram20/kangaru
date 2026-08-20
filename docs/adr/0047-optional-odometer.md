# ADR-0047: The odometer becomes optional, and the trace prices the trip

**Status:** Accepted (21 August 2026)

**Depends on:** ADR-0014 (system settings — this is a new key in the `tracking`
group), ADR-0031 (road routing, which supplies the ceiling), ADR-0035 (the
odometer plausibility ceiling), ADR-0023 (the offline outbox, which decides how
a refusal reaches a driver).

**Extends:** `docs/measured-distance-plan.md`, in its smallest useful form.
That plan is still unbuilt and still worth building; this does not replace it.

**Amends in practice:** ADR-0026 §2 and ADR-0031 §7 both say the settled fare
is the odometer. With this switch off, it is not.

## Context

The owner asked for the ability to turn the odometer off in settings, on the
grounds that *"we can calculate the pricing and the via distance"* now.

That premise is half true, and the half that is false is what shapes this
decision. Routing gives a **quote**; the **settlement** has always been the
odometer. `TripStateMachine::captureClosingOdometer` sets

```php
$trip->distance_km = (string) ($trip->odometer_end - $trip->odometer_start);
```

and `TripPricingEngine` prices from `distance_km`. `gps_distance_km` existed
but fed only a variance *flag* — a review signal, never money.

So this is not a toggle over an existing capability. Removing the odometer
removes the only source of the number every fare is computed from, and
something has to take its place.

### The contractual cost, which the owner was shown before anything was built

PROJECT.md lists six formal acceptance criteria for the Phase 1 MVP, and #4 is
**"Opening and closing odometer (mileage) readings"**. A platform-wide switch
stops producing them for corporate trips too — including the Bank's.

A walk-in-only scope was offered, which could not have broken the contract, and
was recommended. **The owner chose platform-wide knowing the consequence.**
This ADR records that it was a decision rather than an oversight, and §4
records what was built so it cannot be made by accident a second time.

## Decision

### 1. `tracking.odometer_enabled`, on by default and public

One boolean in the existing `tracking` group. On, nothing changes. Off:

- `TransitionTripRequest` stops *requiring* `odometer_start` and
  `odometer_end` — but still accepts and stores them when sent, so a handset
  that has not picked up the setting yet keeps working, and a fleet still
  recording readings does not lose them.
- The driver app drops the reading forms from the flow entirely. **Not
  disabled, not optional — gone.** A labelled field reads as something the
  office wants, and an empty one a driver was allowed to skip looks like it
  failed to save.
- `started_at` and `completed_at` are written regardless. They are acceptance
  criteria #1 and #6 and have nothing to do with the dial; an early draft
  guarded the whole capture method on the switch and produced trips that had
  started with no record of when.

It is `public` because the app renders its trip flow from it, and the app
**defaults to `true`** when it cannot reach the server — the opposite of the
fail-closed rule `useAuthMethods` follows, because the two failure directions
are not symmetrical. Wrongly *off* means the server 422s a missing reading,
which through the outbox surfaces on the sync queue hours after the driver left
the vehicle: a stranded trip. Wrongly *on* means one screen and a few wasted
seconds. The default takes the cheaper mistake.

### 2. The trace prices the trip; the road bounds it

`TripDistanceResolver` owns the entire decision, and returns a `TripDistance`
carrying three things a caller needs together: what to bill, what the trace
actually measured, and whether a human should look.

**Why not the trace alone.** It is the best measurement available —
`RouteDistanceCalculator` sums haversine over the pings and drops segments
below a noise floor, so an idling vehicle accrues no billable metres. But a
measurement with no ceiling is a fare with no ceiling, and two ordinary things
inflate it: jitter on a slow crawl, and a spoofed location.
`trip_locations` carries no mock-location flag — `measured-distance-plan` §1
names that as a fact of the schema — so once the trace prices the fare rather
than merely checking it, **a handset that lies is a handset that pays itself**.
The odometer never had that problem, because a human read a dial somebody else
could photograph.

**So:** the trace is billed unless it exceeds the road between its own two
endpoints plus `tracking.trace_route_ceiling_percent` (30% by default). Over
that, it is **capped and flagged, never refused** — the passenger is at the
kerb and the driver did drive somewhere, so refusing to price the trip punishes
the wrong person for a signal problem.

The property being bought is the plan's: *boundedness*, not precision. There is
no path to a figure that is wildly wrong and silently billed.

**Three sub-decisions worth keeping:**

- **Null distance is written as null, never coerced to zero.** Zero claims the
  vehicle did not move — a complete-looking answer that invites nobody to look.
  Null reaches billing as unpriced work somebody resolves.
- **The endpoints come from the trace, not the order request.** Corporate trips
  frequently have no drop-off pin, so an order-based bound would be unavailable
  for most of what this platform carries. The trace always has two ends, and
  they describe the journey actually driven rather than the one booked.
- **Routing off means unbounded and unflagged.** An operator who has not turned
  `maps.routing_enabled` on has not asked for a second opinion, and flagging
  every trip in that deployment would make the flag mean nothing. That is the
  stated cost of leaving routing off.

### 3. Why the trip's timeline gains a sentence

With the odometer off, *why* a trip was priced at its figure — measured, capped,
or not measurable — is not deducible from three columns. The closing transition
now carries a note onto its `trip_events` row saying which happened and with
what numbers, so a reviewer opening a flagged trip reads it rather than infers
it.

Mechanically this made `applySideEffects` return `?string` rather than hold the
note on the service. `TripStateMachine` is resolved as a singleton, and a
property written during one transition would outlive it and land on the next
trip's timeline — a note about somebody else's journey, on a record treated as
evidence.

### 4. The consequence is stated where the decision is made

The admin console's Distance-checks card shows a warning the moment the switch
goes off, naming the Bank, the acceptance criterion, and the fact that this
reaches corporate trips. It is asserted by a test.

This is the honest way to build what was asked for. Quietly narrowing the scope
to walk-ins would have been overriding the owner; burying the consequence in
this file would have made it discoverable only by whoever reads ADRs.

## Consequences

An operator running walk-in and ride-hailing work can drop a step from every
trip, at both ends, and still bill.

**The fare becomes only as good as the trace.** In a dead zone the trip
completes unpriced and flagged rather than wrong, which is the right failure but
is a new kind of work for whoever reviews it. `distance_variance_flagged` now
carries two meanings — "the readings disagree" when the odometer is on, "this
distance could not be trusted" when it is off — and anything reading that column
should know which regime produced the row.

**The Bank's acceptance criterion #4 is not satisfied while the switch is off.**
Stated plainly because it is the whole cost of this ADR.

**Nothing recomputes history.** Trips completed under one regime keep their
distance; the switch changes what happens next, never what happened.

## What this deliberately does not do

**No per-client or per-service-type scope.** The owner chose platform-wide. The
resolver would support narrowing later without changing shape, and the settings
catalogue is where that would live.

**No multi-stop reference.** A genuine circuit is bounded by the road between
its first and last point, so a vehicle that visits six ATMs and returns near its
start is capped low and flagged — under-billed and visible, rather than
over-billed and silent. It does not bite today because nothing links a `Trip` to
ADR-0045's route stops. **When that linkage lands, `TripDistanceResolver::ceilingFor`
should call `RouteService::via()` with the stops; it is the one place that
changes.**

**`OdometerScreen` is not deleted**, only unreachable while the switch is off. A
setting that can be turned back on should not require restoring a screen.

**The walk-in quote is untouched.** `WalkInFareService` estimates before a trip
exists and has no trace to price from. Only settlement moved.

## Alternatives considered

**Walk-in only.** Recommended, and rejected by the owner in favour of a
platform-wide switch. It remains the safer scope and the resolver does not
preclude returning to it.

**Routed distance alone, priced from pickup to drop-off.** Predictable and easy
to dispute in the passenger's favour, but it is not a measurement: a driver who
detours, waits, or takes a longer road is paid for a journey they did not drive.
It is the right thing to *bound* with and the wrong thing to bill from.

**Refusing to complete a trip with no trace.** Rejected. It strands a driver at
a kerb for a signal problem that is not their doing, and ADR-0023's whole thesis
is that this app runs in dead zones. Completing with a null distance moves the
problem to somebody with a screen and a keyboard.
