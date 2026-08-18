# ADR-0020: Automatic dispatch

**Status:** Accepted (7 August 2026)

## Context

PROJECT.md moved automatic dispatch **into** Phase 1 by owner approval on
2 August 2026, with a one-line justification: *"the platform is a hailing
operator (Faras, Uber, Bolt, SafeBoda), and hailing cannot be manual."*

`Modules/Dispatch/README.md` has carried it as deferred item 1 ever since,
blocked on two inputs. Both now exist:

- **Availability** — ADR-0017 gave one service that answers "is this driver
  or vehicle free for this window", combining status, live trips, leave,
  maintenance and rosters.
- **Distance** — ADR-0019 gave the vehicle's current position.

A third input turned out to be missing and was found only when this was
built: **the pickup had no coordinates.** `bookings.origin` is a string
somebody typed, which is enough for a human dispatcher who knows that "Head
Office" means Kampala Road, and useless to a matcher — ranking by proximity
needs two points and ADR-0019 supplied one.

## Decision

### 1. It suggests; `DispatchService::assign` decides

`DispatchRecommender` returns a ranking. Committing one goes through
`DispatchService::assign` and nothing else, so the pessimistic locks
(AGENTS.md "Concurrency (Dispatch)"), the ADR-0009 allocation rules and the
ADR-0017 availability refusals all apply exactly as they do to a human.

A matcher with its own assignment path would be a second way to write a
trip, and the race guarantee is only as good as its narrowest path. The
existing dispatch race tests still pass unchanged, which is the assertion
that this held.

### 2. Bookings gained nullable pickup coordinates

`origin_latitude` / `origin_longitude`, nullable, no backfill. Every booking
that predates this has none and never will, so the recommender ranks on
availability and capacity for those rather than refusing to answer.
Requiring them would have meant running a geocoder over historical rows
nobody will dispatch again.

Destination is deliberately left out: dispatch cares who can reach the
pickup soonest. The far end matters to pricing and route preview, and
neither is this ADR.

### 3. Hard filters first, then a score

Anything the assignment endpoint would refuse is **dropped, not ranked
low** — offering a candidate that 409s is worse than offering fewer, and a
low-ranked unusable option still surfaces on a thin morning. The filters are
availability, seating capacity, and exclusive allocation to another client.

What survives is scored:

| Component | Weight | Why |
|---|---|---|
| Contracted to this client | +1000 | A client who paid to have vehicles set aside should get them. A matcher quietly preferring a closer non-contracted van would override a commercial agreement on a heuristic. |
| Proximity to pickup | `500 / (1 + km)` | Steep at the short end on purpose: 1 km versus 3 km is minutes a passenger waits; 40 km versus 42 km is the same answer. |
| Spare seats | `−min(spare, 20)` | A nudge, not a rule. A fifty-seater collecting one passenger is legal and wasteful, and the spare seats are what a dispatcher would notice. |

Distance is straight-line, not road distance. Road distance needs Mapbox's
Directions API, which is unbuilt and metered; at Kampala's scale the two
agree closely enough to *rank* by, and this is a ranking rather than an ETA.

### 4. Every score is reported as a sentence

`reasons` comes back with each suggestion: *"Contracted to this client for
this date"*, *"About 0.4 km from the pickup"*, *"Pickup has no coordinates,
so distance was not used"*.

This is not decoration. AGENTS.md ships dispatch algorithm changes behind a
flag precisely because a matcher is something operators have to come to
trust, and a ranking nobody can audit is one a dispatcher overrides on
instinct — which is manual dispatch with extra steps.

Where an input is missing, the response says so rather than substituting a
guess. A distance nobody measured is worse than no distance.

### 5. One flag, and it gates only the committing half

`dispatch.automatic_enabled`, **off by default**.

`GET /bookings/{id}/recommendation` is always available. Reading a
suggestion can do no harm, and watching the matcher choose on real bookings
is how an operator builds confidence in it before it acts alone.

`POST /bookings/{id}/auto-assignment` commits the top suggestion and is
gated. A matcher that has never been watched should not be dispatching
unattended.

### 6. Losing the race is a 409, not a silent second choice

If another dispatcher takes the same van between ranking and committing, the
endpoint returns the conflict rather than quietly trying the runner-up.
Picking again without saying so would make the matcher unpredictable at
exactly the moment somebody is watching it decide.

## Consequences

The platform can now answer "who should take this booking" and, with the
flag on, act on it — through the same locked, audited path a human uses.
`Modules/Dispatch/README.md`'s oldest deferred item is closed.

**Pickup coordinates are now captured** (7 August 2026, completing §2).
`order_requests` gained pickup and drop-off coordinates, `POST
/public/order-requests` and `POST /bookings` accept them, and the public
order form sends the `lngLat` it had been holding for its map all along.

Three things that only surfaced in the wiring:

- **The coordinates are sent only while the typed text still matches the
  place that was picked.** Somebody who selects "Acacia Mall" and edits the
  field to "Acacia Mall, gate 3" has moved the pin in their head; sending
  the old point would dispatch a driver to the wrong side of a building with
  more confidence than the typed text deserves.
- **A device fix is labelled by its `detail`, not its `name`.** The first
  version compared `place.name`, which is the literal string "Current
  location" — so coordinates were dropped for every order placed from the
  phone's own position, which is most of them. The rule now compares against
  the label the field was actually filled with.
- **Range validation cannot catch a Kampala lat/lng swap.** 0.3476 N /
  32.5825 E swapped is 32.5825 N / 0.3476 E — a point off the coast of
  Ghana, with *both values inside their valid ranges*. A test asserting the
  swap was refused was written, failed, and has been replaced by one that
  records the limitation. Catching it needs a service-area bounding box,
  which is geofencing work, and a hardcoded Uganda box would be wrong the
  day the platform crosses a border.

`DECIMAL` columns come back from MariaDB as **strings**, so both models cast
the coordinates to float — otherwise the API emitted `"0.3476000"` where the
contract and every map library expect a number.

Still not captured: the internal booking dialog has no address
autocomplete, so a dispatcher raising a booking by hand still produces one
without coordinates, and the recommender says so. Extracting the public
form's place picker into a shared component is the remaining piece.

**A test that passed for the wrong reason was caught by mutating the
scorer.** With distance scoring removed, the "prefers the nearer vehicle"
test still passed: both candidates scored equally, `sortByDesc` is stable,
and the near vehicle happened to be created first. The fixtures now create
the far vehicle first, so only distance can reorder them, and the same trap
in the contract test was fixed alongside. Both mutations now fail.

## What this deliberately does not do

**Preferred driver and preferred vehicle**, which PROJECT.md lists as
dispatch inputs. There are no such columns on a booking, and inventing them
here would be designing a feature nobody has specified.

**Geofence, branch and depot**, also listed. The reference tables do not
exist — see `Modules/Fleet/README.md` deferred item 7. When they arrive they
are additional filters and weights on this same scorer, not a rewrite.

**Driver-to-vehicle pairing beyond one-per-vehicle.** Pairing every free
driver with every free vehicle is a cross product nobody reads — 3,000 ×
2,000 rows to choose one from — and once both are free the choice of driver
barely depends on the choice of vehicle. When qualifications exist (who may
drive a bus), that stops being true and the pairing becomes a real problem.

**Auto-dispatching on a schedule.** Nothing polls the queue and assigns
unattended; a human presses the button. That is a deliberate first step for
a matcher whose behaviour nobody has watched yet, and the flag is what makes
the second step a decision rather than a default.

## Alternatives considered

**Ranking without distance, on availability alone.** What the inputs allowed
before this ADR, and too weak to call a matcher: on a normal morning most of
the fleet is free and the ranking would be arbitrary.

**Auto-assigning without a suggestion endpoint.** Rejected in §5 — an
operator cannot come to trust a black box they never watched.

**Road distance via Mapbox.** Better, metered, and unbuilt. Straight-line is
sufficient to *rank*; it would not be sufficient to promise an ETA, and this
promises none.

**Trying the runner-up when the top choice is taken.** Rejected in §6 —
unpredictability is the expensive failure for a system being evaluated.
