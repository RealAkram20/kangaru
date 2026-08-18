# ADR-0045 — Measured distance: the trace is the fare, the road is the check, the odometer is the backup

**Status:** accepted, 2026-08-18. Phases 1 (shadow) **and 2 (billing and the
handset)** built the same day; Phases 3–4 of
`docs/measured-distance-plan.md` are sequenced there and each lands behind its
own decision. **Phase 2 changes no fare until an operator issues a rate card
version that says so** — `distance_policy` defaults to `odometer` on every
existing version and every new one that does not name another.
**Extends:** ADR-0035 (the odometer ceiling and the `tracking` settings
group), ADR-0003 (the GPS ingestion path this measures from), ADR-0031 §2
(the OSRM provider seam), ADR-0023 (the offline thesis this must not break).
**Amends:** ADR-0026 §2 and ADR-0031 §7, both of which say the *settled* fare
comes from the odometer pair. That remains true **today**; this ADR decides
that it stops being true when Phase 2 lands, and builds the thing that
replaces it now, in shadow.
**Supersedes:** `docs/distance-and-fare-integrity-plan.md` §4 Phase 2 (the
`distance_source` dial), and its §8's refusal to design the unit — the owner
ruled on 2026-08-18 that both figures are inputs and, later the same day, that
the platform is *not odometer based: the odometer is the backup*.

## Context

The fare's distance is a number a driver types (`distance_km = odometer_end −
odometer_start`, `TripStateMachine` line 133). The GPS trace is a watchdog:
`RouteDistanceCalculator` sums haversine hops, `reconcileAgainstGps()` sets a
flag beyond a threshold, and nothing consults the flag before invoicing or
paying. ADR-0035 recorded the consequence — a 90,004 km trip priced at UGX
198,013,800 — and put a ceiling on the typo. It said plainly that a ceiling
does not make distances trustworthy: a 6 km trip typed as 13 km is inside any
ceiling, and only evidence sees it.

The owner's answer, asked what should carry the fare, was to *combine* the
figures, and then, pressed, that the odometer must not be the base. This ADR
is the design of that: what "measured" means, how it is checked, when the
odometer stands in, and what happens when nothing can vouch for a figure.

Every fact below about the code was verified on the branch, and four of them
shaped the design rather than decorating it:

1. Pings arrive through a queued job and the completion through the handset's
   outbox, often *before* the last batch — so nothing can measure at the
   moment of completion.
2. A walk-in fare is settled synchronously at completion and paid in cash at
   the kerb.
3. Corporate bookings carry an origin pin only; there is no geocoder.
4. The app streams pings only during Trip Started / Waiting / Trip Resumed
   (`shouldStreamGps`), so the trace already spans the odometer window; and
   `OsrmProvider` already exists with `routing_provider` defaulting to
   `osrm`.

## Decision

### 1. Four witnesses, one figure, one grade

Per completed trip, `Modules\Trips\Distance` produces:

- **the measured trace** — pings cleaned (mock, poor accuracy, duplicate
  second, teleport, jitter), split into runs where the device fell silent for
  longer than `gap_seconds`, each run snapped to roads by OSRM `match` in
  chunks of ≤ 100, gaps routed by OSRM `route`; `gps_km = matched_km +
  inferred_km`, with *coverage* (share of the trip the device demonstrably
  reported) and *inferred share* (routed-not-matched over the total);
- **the reference route** — the road through the order's pickup and drop-off
  pins, or, on a trip with no pins, between the trace's own ends. Not a
  measurement: a bound. Real drives run longer than the shortest road, not
  shorter;
- **the odometer** — unchanged capture, unchanged ceiling, new role;
- and, for the `route_capped` policy, whether the driver **declared a stop**
  (a Waiting period).

`DistanceResolver::decide()` is pure and is the whole rule:

```
trace trusted        → bill the trace.
                       A if the road agrees (within route_tolerance_percent
                       + 0.5 km), B if not — a detour, or a road the map
                       lacks. Billed either way.
trace not trusted,   → the odometer stands in, held inside the corridor
  road known           [corridor_floor, corridor_ceiling] × reference.
                       B if the reading sat inside it untouched;
                       C if it had to be clamped — held for a person.
no road either       → whatever there is, graded C.
```

*Trusted* is every bar at once: `coverage ≥ min_coverage_percent`,
`inferred_share ≤ max_inferred_share_percent`, **no mock ping anywhere in the
trace**, `teleports ≤ max_teleports`, and at least two usable pings.

There is no averaging and no median. An earlier sketch billed the median of
three figures; it was dropped because a median cannot be explained to a
driver in one sentence and it lets a bad odometer reading pull a good trace
by a third. Every branch bills exactly one witness and says which.

### 2. Four grades, and two of them are a gate

`A` verified, `B` bounded, `C` held, **`U` unverified**. A and B bill
automatically. **C does not bill** — not an invoice, not a ledger pair — until
a person with `trips.transition.finance` clears it with a reason, audited
(`POST /trips/{trip}/distance/clearance`).

`U` is the grade Phase 2 forced into existence, and it is the difference
between a watchdog and a gate. C means the evidence speaks **against** the
figure — a trusted trace contradicts the odometer, or a reading had to be
clamped to fit the road. U means there is **no evidence either way**: no
usable trace and no reference route, so nothing vouches for the odometer and
nothing contradicts it. ADR-0035 refused to *flag* such a trip — "that is
missing evidence, not a discrepancy; flagging it would flag every trip taken
before a device was fitted" — and the same principle decides the gate: under
the `odometer` policy a U trip bills exactly as it always did; under a
trace-priced one it is held, because the contract asked to be billed on
something that was not measured.

Without U, switching the resolver on would have held every trip on a fleet
with no OSRM server — which is to say every deployment on the day it upgrades.
The first draft did exactly that, and the whole existing invoice suite went
red; that is how the distinction was found.

**One exception, and it is not a grade:** a trace carrying a mock-location
ping is held even with no road to check it against. A faked position is not
"no evidence" — the device spoke against the trip.

The gate is `Modules\Billing\Pricing\DistanceGate`, called by both
`InvoiceService` and `WalkInFareService` so the two cannot drift, and switched
by `tracking.held_blocks_billing` (default **on** — controls default on).

### 3. Policy is a commercial term and lives on the rate card version

`gps_primary` (the rule above; the walk-in tariff's default when Phase 2
lands), `route_capped` (the rule, then never more than reference ×
(1 + `detour_cap_percent`) unless a stop was declared — the offer to a
corporate client: you never pay for a detour), `odometer` (bills the reading,
still graded and still held when a trusted trace contradicts it — for a
contract that names the odometer as its evidence).

Versioned and immutable like everything else on a rate card, so changing a
policy tomorrow cannot restate an invoice issued today.
`rate_card_versions.distance_policy` **defaults to `odometer`** on every
existing row and every new version that does not name another: that is
today's behaviour, so pointing the pricing engine at the resolver's figure
changed no fare. The flip to trace-priced fares is issuing a version that
says `gps_primary` — dated, auditable, reversible by issuing another, and
never a deploy.

The resolver asks for the policy through `DistancePolicySource`, an interface
Trips owns and Billing implements (`RateCardDistancePolicySource`). Billing
already depends on Trips; the alternative closed the loop and made neither
module movable — the same reasoning that made `TripCompleted` an event.

### 4. Every threshold is the operator's, and every row records them

Twelve keys in the `tracking` settings group (see `SettingsService`), each a
business rule about when a trace is believed. `trip_distance_evidence`
stores `thresholds` **as they stood** for every resolution, beside every
witness and quality number, the dropped tally by reason, the provider, and
the matched geometry. This is AGENTS.md's "every invoice line stores its
inputs" applied to the step before the invoice: an operator tightening the
corridor next month does not restate what this month's fare was decided on.

The noise floor stays in `config/tracking.php` — ADR-0035's line between a
business rule and a property of the apparatus, kept.

### 5. Resolution runs after a grace period and re-runs on late pings

`TripCompleted` → a listener → `ResolveTripDistance` delayed by
`resolution_grace_seconds`. `RecordTripLocations` → the same job again
whenever pings land for a trip that has already completed. The job is unique
per trip, so a device draining a day's outbox schedules one run and not one
per batch; a batch landing after a run has started schedules a fresh one.
Each run appends an evidence row; the trip's columns reflect the latest.

The trip's fare therefore cannot be settled at the kerb from this figure, and
Phase 2 is that consequence worked through:

- **`SettleWalkInFare` moved** from `TripCompleted` to `TripDistanceResolved`
  and `TripDistanceCleared`. `CreditDriverForCompletedTrip` followed it, after
  it, for the same ordering reason as before.
- **`PriceProvisionalWalkInFare` took its place on `TripCompleted`.** It
  prices, through the same engine, the distance that can be known at the kerb:
  the odometer delta under the odometer policy, and the handset's own
  measurement of its buffered pings (`provisional_distance_km`, sent with the
  completion) under a trace-priced one. `trips.fare_provisional_minor` is
  never overwritten — it is what the passenger was shown and what the driver
  took.
- **The driver's ledger records what was collected, not what settled.**
  `cash_collected` is the provisional figure when there was one; `fare_earned`
  is the commission share of the settled fare. When the two differ the balance
  says so — the driver holds the excess, or the office owes the shortfall —
  instead of a ledger asserting cash that never changed hands.
- **The handset warns at the keypad** when the typed odometer delta disagrees
  with what it measured, by more than `tracking.variance_threshold_percent`,
  which is served on the trip for the reason ADR-0035 gives about the ceiling.
  A warning, never a refusal: the phone measures crow-flight over the pings it
  happens to hold, so it reads short on a winding road and shorter after a
  dead zone. It is good enough to catch an extra digit while the dashboard is
  still in front of the driver, which is the only moment that mistake is free
  to fix.

### 6. The engine is self-hosted OSRM behind its own switch

`MeasurementRouter` is a second seam beside `RouteProvider`, deliberately
not a widening of it. The map's provider is gated by `maps.routing_enabled`
and may be Google, a metered API; this path runs on every completed trip and
must never resolve to a vendor that bills per request. `tracking.trace_
matching_enabled` defaults to **false** because `maps.osrm_base_url` defaults
to the project's public demo, which is not for production; it goes on once
an operator points the URL at their own box (Uganda extract: ~1 GB disk,
~1.5 GB RAM, one container). Off, the measurer falls back to haversine with
everything inferred and no reference route, and every trip is grade C —
which is the honest state, and is what the shadow report shows until the box
exists.

### 7. Coverage is skew-tolerant

`started_at` is the server's clock; `recorded_at` is the handset's. Coverage
is the presence span less its internal silences, over the longer of that
span and the trip's duration — so a clock offset is not a pair of dead zones,
while a trace that started late or stopped early still loses coverage.
*Presence* is every non-mock ping's timestamp, kept or dropped: a ping
dropped as jitter still proves the handset was awake; only a mock ping proves
nothing.

### 8. The mock-location flag travels with the ping

`trip_locations.is_mock` and `pings.*.is_mock` on the ingestion contract,
optional, absent stored as false. Counted by the cleaner and fatal to trust
in the resolver; **not yet refused at ingestion**, until it has been observed
in the wild long enough to know how often a real handset sets it by mistake.
The app does not send it yet — the driver app is untouched by this phase.

### 9. What is wired, and what still changes nothing

`TripPricingEngine::chargeLines()` reads `billed_distance_km ?? distance_km`.
`distance_km`, `gps_distance_km` and `distance_variance_flagged` are unchanged
and mean what ADR-0035 says — the odometer is still captured, still
photographed, still bounded at the transition, and still the fleet's mileage
record.

**No fare moves until a rate card version says `gps_primary` or
`route_capped`.** Under `odometer` the resolver's figure *is* the odometer
delta, the gate lets an unresolved trip through, and a U trip bills as it
always did. The flip is a commercial act on a rate card, taken after the
shadow report shows what the grades actually look like on this fleet — the
criteria are in the plan's Phase 1, and they are not met yet, because no OSRM
server is running.

Still not built, deliberately: the console's **review queue** for held trips
(the evidence is served at `GET /trips/{trip}/distance` and clearance is a
POST, but nothing lists held trips yet), and everything in Phase 4.

## Consequences

- Every completed trip now carries a figure and a grade it *would* be billed
  on, and a row explaining why. The shadow report over those rows —
  `GET /reports/distance`, "Measured distance" on the console's Reports page
  — is the instrument the flip is judged on, and the tracking settings card
  carries the switch and every dial.
- Two new columns on `trips` are written from the queue, on a model with
  `Auditable`; each resolution appends an `updated` audit entry with the
  diff. Acceptable and, for a figure that will be billed, arguably right.
- With matching off, every trip is grade C. An operator reading the first
  shadow report before pointing OSRM at their box will see a wall of C and
  must not conclude the fleet is fraudulent; the `provider` column says
  `haversine`, and the README says why.
- In tests the queue is synchronous, so completing a trip now also resolves
  it inside the same request. Feature tests that complete trips run the
  pipeline; they got no slower that anyone measured, and they exercise it for
  free.
- **Corporate trips have no independent reference** until bookings carry a
  drop-off pin. Trace-end references are road-shaped but not independent of
  the trace; `reference_source` records which kind a row got.
- **Sophisticated spoofing** — a hardware-level fake trace with a plausible
  speed profile — is not defeated by this. It is made expensive: the trace
  must agree with the road, the odometer chain on the vehicle must agree
  across trips (Phase 4), and the mock flag must be suppressed. Turning
  "type a bigger number" into "forge three consistent witnesses" is the
  security property; perfection is not claimed.
- The five decisions in the plan's §7 — the default thresholds, what a
  grade-C walk-in driver is paid today, who clears, the Bank's wording, where
  OSRM lives — remain the owner's and are not made here.

## Alternatives considered

**Bill the median of the three figures.** Robust to one bad witness in
theory; rejected because it cannot be explained in one sentence and a bad
odometer moves a good trace by a third of the disagreement.

**A `distance_source` dial (`odometer` | `gps` | `lesser_of` |
`greater_of`).** The earlier plan's shape. Right for "choose one figure",
wrong for "trust one and bound it by the others"; superseded.

**Google Directions as the reference engine.** Traffic-aware and already
wired for the map. Rejected for this path: it bills per request on a call
made for every trip, and a metered vendor one config value from the per-trip
path is the failure the separate seam exists to prevent.

**Refusing mock pings at ingestion now.** Cleaner; rejected until the flag's
false-positive rate on real handsets is known — a driver whose phone lies
about mocking would lose their trace and, later, their pay.

**Measuring at completion, synchronously.** Rejected on fact 1: it measures
whatever happened to have arrived, which is how the watchdog came to run
against empty tables without anyone noticing (ADR-0035 §Context 2).
