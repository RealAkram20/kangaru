# ADR-0045: Multi-stop journeys and client routes

**Status:** Accepted (20 August 2026 — owner reversed the earlier refusal after
supplying the business case it was missing, and ruled on all six forks)

**Reverses:** the "Multi-stop trips — offered and declined by the owner" entry
in `docs/agent-worklog.md`, and the deferral in `Modules/Bookings/README.md`
item 1.

**Depends on:** ADR-0001 (tenant scoping — a route belongs to one client),
ADR-0009 (allocation and dispatch), ADR-0021 (zones, whose pricing path this
must not disturb), ADR-0031 (road routing — the provider this widens),
ADR-0023 (the offline thesis the driver's stop actions must not break).

## Context

Multi-stop was offered to the owner once and declined. Three places in this
codebase are written around that refusal and say so at length:
`mobile/src/trips/record.ts` builds the driver's route rail out of
`trip_events` *because* stops do not exist, `Modules/Bookings/README.md`
defers it, and `TripPricingEngine` prices one journey.

The refusal was right at the time, and it was right for the reason ADR-0031
records about a different refusal: it was about **inventing**, not about
**having**. There was no business fact that needed stops. A stops table, a
public order form, dispatch and per-stop pricing would all have been built
against a hypothesis.

The hypothesis arrived. Corporate clients — Centenary Bank first — service
their ATM estates by sending a team out on a circuit: head office, then ATM,
then ATM, then ATM, then back. That is not a trip with a destination. It is a
route, run repeatedly, by named people, and the client wants to build it
themselves and watch it run.

So the question is no longer whether stops exist. It is what a stop *is*, and
the answer this ADR gives is that there are two different things wearing the
same word.

## Decision

**A route is a plan a client owns and edits. Stops are evidence a trip
carries and never changes. A trip built from a route copies its stops, and
from that moment the two have nothing to do with each other.**

That separation is the whole decision; everything below follows from it.

### 1. Two object families, joined only at booking time

| | Route (the plan) | Trip stops (the evidence) |
|---|---|---|
| Owned by | the corporate client | the trip |
| Lives on | the client's Routes screen, reusable | one journey, once |
| Changes | the client's admin edits it any time | never |

`client_places` · `client_routes` · `client_route_stops` ·
`client_route_members` on the plan side; `trip_stops` on the evidence side.

Stops are **copied** onto the trip, not referenced. This is
`RateCardVersion`'s reasoning applied to geography: editing the Kampala ATM
run in October must not change what September's invoice was for. A
`client_place_id` rides along on the copy, nullable, **for grouping in reports
only** — never read back to re-derive what a trip did.

`client_places` is the ATM register in its own right, and it is the same
object the corporate panel plan's E3 calls "default pickup addresses". It is
built once and serves both.

### 2. The lifecycle does not change

`waiting ⇄ trip_resumed` is the graph's only cycle and it already means what
a stop means. Arriving at an ATM is a pause; leaving is a resume.

| Driver taps | Transition | Effect on `trip_stops` |
|---|---|---|
| Arrived at stop *n* | → `waiting`, payload carries `stop_id` | `arrived_at`, status `arrived` |
| Continue | → `trip_resumed` | `departed_at`, status `done` |
| Skip this stop | none | status `skipped` + reason, event recorded |
| Add a stop here | none | new row, `source = added_by_driver` |
| Last stop | → `trip_completed` | closing odometer as today |

**No new `TripStatus` case, and no new edge.** The alternative — an
`arrived_at_stop` / `departed_stop` pair — would have rewritten the transition
map, `TripPolicy::DRIVER_JOURNEY_STATES`, the driver app's mirror of it in
`mobile/src/trips/transitions.ts`, and every lifecycle test, in exchange for
nothing the existing cycle does not already express.

`trip_events` gains a nullable `stop_id`. It remains the append-only timeline,
and it remains the only place the order of events is recorded.

### 3. Pricing is untouched (owner's ruling)

One base fare, total distance, total waiting, min/max cap, night multiplier,
zone rate — exactly as `TripPricingEngine` prices a journey today.

This is not a deferral. **The waiting at every ATM is already priced**, because
`WaitingTimeCalculator` derives billable waiting from the `waiting` /
`trip_resumed` transitions §2 reuses. A seven-stop circuit that idles fourteen
minutes at each site bills those ninety-eight minutes today, before a line of
this ADR is implemented.

A per-stop fee was offered and declined. It would have needed a rate row, an
`InvoiceLineType` case and a branch in `InvoiceLine::computeAmount()` — the
single definition that makes an invoice reproducible — to charge for something
distance and waiting already capture.

### 4. A driver may add a stop, and it is flagged, not billed (owner's ruling)

Every stop carries a `source`: `planned`, `added_by_driver`,
`added_by_dispatch`, `added_by_client`. A driver standing at a kerb can extend
the journey without waiting for anyone to tap approve.

`trips.unplanned_stop_count` surfaces it on the trip record and as a note on
the invoice — **a note, not a charge**. The client sees that the run deviated
and where; nobody bills for the deviation.

This is `distance_variance_flagged`'s posture, and it is the platform's
general answer to operational reality: record it, show it, do not hide it and
do not quietly monetise it.

### 5. Distance stays start-and-end on the odometer; per-leg is GPS

The Bank's six data points are untouched. `odometer_start` and `odometer_end`
still bracket the whole run, still photographed, still reconciled.

**Per-leg distance comes from `trip_locations` and is labelled as
GPS-derived.** Capturing an odometer reading at every stop was considered and
rejected: seven photo prompts per circuit is how odometer capture stops
happening by Wednesday, and a reading nobody takes is worse than a reading
nobody asked for.

Per-stop dwell time is not derived at all — `arrived_at` and `departed_at` are
real timestamps.

### 6. Skipped stops are first-class

The ATM was serviced this morning; the road is closed; the site is dark. This
happens weekly and the Bank will ask about it. A skipped stop keeps its row,
its sequence and a reason. It is not deleted, and the run is not marked
incomplete for containing one.

### 7. Routing gains waypoints, and never reorders them

`RouteProvider::route()` widens from four floats to an ordered list of points;
both OSRM and Google support waypoints natively, so both implementations
change shallowly. `RouteService`'s cache key hashes the snapped origin plus
every subsequent point, and its five-minute TTL is unchanged.

**Stop order is never optimised automatically.** A cash run's sequence is an
operational and security decision — which ATM is empty, which is safe at
which hour — not a travelling-salesman problem. Reordering may later be
*offered* as a suggestion the client accepts. It is never applied silently.

### 8. A route names the team who ride it, and is raised by hand (owner's rulings)

`client_route_members` are the employees who travel the circuit — the Bank's
servicing team — not a permission to book. Assignment answers "who is on this
run", and the members see it on their own dashboard.

Routes carry **no schedule**. A route is a template; a booking is raised from
it when the run is needed. Recurring generation stays where the corporate
panel plan already put it, as B3.

### 9. Access

New `Permission::ROUTES_VIEW` / `ROUTES_MANAGE`, and a new
`ClientCapability::MANAGES_ROUTES` so a client's own administrator decides
which of their people may build routes — the E2 mechanism, unchanged.

Shanitah's staff see a client's routes **read-only**, on the live map and the
trip record. Building a client's ATM circuit is the client's job; that is the
premise of the whole panel.

## Consequences

**The driver's route rail stops being an inference.** `record.ts` documents
that it draws the mockup's *Stop 1 / Stop 2* out of `trip_events` because
stops do not exist. They now do, and that comment and the two beside it must
be corrected rather than left to mislead the next reader.

**A four-stop trip and a no-stop trip are the same row.** `trip_stops` is
empty for every trip in the database today and for every point-to-point trip
after this. Nothing backfills, nothing migrates, and no existing screen has to
learn what a stop is in order to keep working.

**Cross-client isolation gains three tables to leak through.**
`client_places`, `client_routes` and `client_route_stops` are tenant-scoped
and each needs the `CompanyCrossTenantIsolationTest` treatment. The corporate
panel plan calls a leak between clients the one bug that ends this, and a
client's ATM locations are exactly the kind of data that sentence is about.

**Waiting time becomes visible in a way it was not.** Once dwell is shown per
stop, a client can see that a driver idled fifty minutes at one ATM — and
will ask. The number was always billed; it was never itemised. That is an
improvement and it is also a conversation Shanitah should expect to have.

**The stop-order refusal will be re-litigated.** Somebody will point out that
the provider can shorten the circuit and that we are declining free savings.
The answer is §7, and it should be quoted rather than re-argued.

### 10. A driver runs the circuit of the client whose trip it is (owner, 20 August 2026)

**Amends §8.** That section said route membership answers "who is on this
run" and is *not a permission*. It now carries one narrow permission after
all, and the amendment is recorded rather than quietly folded in.

The owner's case: the passenger in the car is a corporate client's own staff,
the crew reshuffles the day's work between themselves, and a driver who
cannot follow that is a bottleneck standing at a kerb.

**Scope is the trip, not the estate.** A driver sees the active routes of the
client whose trip they are **currently driving**, and no other client's, and
none at all when they are between jobs. The link is `trips.tenant_id`, which
already exists — no new assignment table, and nothing to keep in step.

This is deliberately not "any client's routes". A bank's full ATM list in
service order is a cash-logistics document; `docs/security-gate.md` F2 exists
for that direction of leak. Bounded to one client, during one live trip, it
is the same information the crew in the car already has.

**"Picking" a route sets a trip's itinerary. It does not create a trip.**
Dispatch still decides that work exists, which vehicle runs it (ADR-0009) and
whether the client approved it. What the driver chooses is *which circuit
this already-assigned trip follows*, and how the stops are ordered once the
day changes. A driver creating trips from nothing would bypass allocation and
the approval flow together, and neither was on offer.

Every stop applied this way is copied onto `trip_stops` exactly as §1
requires, and carries `source = added_by_driver` when the driver departs from
the plan — §4's flag, unchanged.

## What this ADR does not decide

- **Recurring schedules** — B3 in the corporate panel plan, deferred by the
  owner's ruling in §8.
- **Proof of service at a stop** — a photograph or signature per ATM. The
  Bank's auditors may want it; it is a capture step on top of §2 and disturbs
  none of the above.
- **Per-stop pricing** — declined in §3, not deferred. Reopening it means
  reopening this ADR.
- **A driver creating a trip from a route.** §10 was explicitly narrowed to
  choosing the itinerary of a trip dispatch already assigned. Self-dispatch
  is a different feature with ADR-0009 and ADR-0020 to answer to.
- **Progress on the live map.** The planned-circuit layer draws sites, never
  a visited state: until `trip_stops` exists there is nothing to observe, and
  a colour would be an invention.
