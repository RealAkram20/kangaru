# Measured distance — the plan

**Status:** plan, agreed in principle by the owner on 2026-08-18. Nothing here
is built. Building starts with the ADR in Phase 1 and not before.
**Decides:** the fare is priced from the **measured trace**, checked against a
**road-routed reference**, and the **odometer is a backup witness** — kept for
fleet mileage and photographic evidence, entering the arithmetic only when the
trace cannot be trusted, and even then never allowed past what the road allows.
**Supersedes:** `docs/distance-and-fare-integrity-plan.md` §4 Phase 2 (its
"distance source" dial) — this is the stronger answer to the same question.
Its Phases 0, 1, 3, 4 and 5 stand and are folded into the sequence below. Its
§8 recorded the owner's ruling of earlier today — *both figures are inputs, in
an in-app algorithm over fixed routing and dynamic time factors, its own unit
of work* — and declined to design it. This is that design; §9 answers §8's
questions. Later the same day the owner refined the ruling: **not odometer
based — the odometer is the backup**, which is what §2 builds.
Extends ADR-0035; will amend ADR-0026 §2 and ADR-0031 §7 (both say the settled
fare is the odometer) through ADR-0045.

Everything in §1 was verified against the code on this branch. Numbers marked
*(default)* are proposed operator settings, not constants.

---

## 0 · Why not one source

Every single source is faultable here:

| Source | Typical error vs true road distance | How it is faulted |
|---|---|---|
| Vehicle odometer | ±2–4 % (calibration, tyres) | one thumb, one digit — ADR-0035's 90,004 km |
| Raw haversine over pings (today's `RouteDistanceCalculator`) | ±3–6 % | curves under-read, jitter over-reads, spoofable |
| **Map-matched trace** | **±1–3 %** on mapped roads | spoofing, dead zones, roads OSM lacks |
| Routed reference (OSRM) | real drives run 0–15 % *longer* | not a measurement — a bound |
| Straight line (today's walk-in quote) | −20 to −40 % | not evidence of anything |

The property this plan buys is not precision, it is **boundedness**: there is
no path through the algorithm to a figure that is wildly wrong and silently
billed. A trip is within a few percent of true, or inside a corridor the road
defines, or *held*. On a 10 km trip at UGX 1,500/km a 2 % error is UGX 300 —
inside the tariff's own rounding.

---

## 1 · What exists, and the four facts that shape the design

1. **The trace is good.** The app pings every **10 s / 25 m** at
   `Accuracy.High` (`mobile/src/location/GpsStreamer.ts:13-20`), buffered
   through the offline outbox and posted in batches of up to 500
   (`StoreTripLocationsRequest`). `trip_locations` carries lat/lng,
   `speed_kph`, `heading_degrees`, `accuracy_metres`, `recorded_at` (device
   clock). It does **not** carry a mock-location flag.

2. **Reconciliation is synchronous and pings are not.**
   `TripStateMachine::captureClosingOdometer()` calls `reconcileAgainstGps()`
   in the completion request, while pings land through the queued
   `RecordTripLocations` job — and the completion itself arrives through the
   handset's outbox, possibly *before* the last ping batch. Today that means
   the flag is computed against whatever happens to have arrived. **The
   resolver therefore cannot run at completion; it runs after a grace period
   and re-runs when late pings arrive.**

3. **Walk-in settles at completion, synchronously.** `SettleWalkInFare`
   listens to `TripCompleted` and prices immediately from `distance_km`. A
   cash passenger pays at the kerb, possibly offline. **The handset must show a
   provisional fare from its own buffered pings; the server's figure is
   authoritative and any difference is a driver-ledger adjustment, never a
   passenger conversation.**

4. **Corporate trips have no drop-off pin.** `order_requests` carries pickup
   and drop-off coordinates; `bookings` carries origin only, and there is no
   geocoder. **The route reference therefore takes its endpoints from the
   pins when it has them and from the matched trace's own ends when it does
   not** — which also means a trip with no trace and no pins has no reference,
   and that is grade C by construction.

Also in place: `OsrmProvider` (`Modules/Trips/Routing`), with
`maps.routing_provider` defaulting to `osrm` and `maps.osrm_base_url`
defaulting to the project's public demo server, which is rate-limited and not
for production; `RouteService` caching on a snapped origin (ADR-0031 §4); the
`tracking` settings group with `variance_threshold_percent` and
`odometer_max_km_per_trip` (ADR-0035); `TripPricingEngine`, pure, reading
`$trip->distance_km` (`chargeLines()` line 116); `maximum_charge_minor` on rate
rows, implemented and unset.

---

## 2 · The algorithm

Run per completed trip by `ResolveTripDistance`, a queued job.

**Step 1 — Clean the trace** (`TraceCleaner`)
Drop, and record why: pings flagged mock by the OS; pings with
`accuracy_metres` above `tracking.max_ping_accuracy_metres` *(default 50)*;
pings whose implied speed from the previous kept ping exceeds
`tracking.max_plausible_speed_kph` *(default 160)* — teleports; segments under
`config('tracking.min_segment_metres')` (exists). Output: an ordered list of
kept pings plus a `dropped` tally by reason.

**Step 2 — Map-match** (`OsrmMatchProvider`, OSRM `/match/v1/driving`)
Chunks of ≤ 100 coordinates with `timestamps` and `radiuses` from
`accuracy_metres`. Each matching produces `matched_km`. Where the chunk fails
(`NoMatch`, or OSRM splits the trace) or two consecutive kept pings are more
than `tracking.gap_seconds` *(default 120)* apart, the gap is **routed**
(`/route/v1/driving`, existing provider) between its ends and the result is
`inferred_km`, marked as such.

`gps_km = matched_km + inferred_km`
`coverage` = kept-ping time span ÷ (`completed_at − started_at`)
`inferred_share` = `inferred_km ÷ gps_km`

Where OSRM is unreachable the step degrades to `RouteDistanceCalculator`'s
haversine with `inferred_share = 1.0`, so a routing outage never blocks a
resolution — it lowers the grade.

**Step 3 — Route reference** (`/route/v1/driving`, one call, existing provider)
Endpoints: the order's pickup → declared stops → drop-off pins when present;
else the first and last matched points. `route_km`, or null.

**Step 4 — Odometer** (unchanged capture, new role)
`odo_km = odometer_end − odometer_start`, still bounded by ADR-0035's ceiling
at the transition. Kept for the vehicle's mileage chain and the photograph.

**Step 5 — Decide** (`DistanceResolver`)

```
trustworthy = coverage ≥ tracking.min_coverage_percent (80)
          and inferred_share ≤ tracking.max_inferred_share_percent (25)
          and dropped.mock == 0 and dropped.teleport ≤ tracking.max_teleports (2)

if trustworthy:
    billed = gps_km
    grade  = A  if route_km is null
                or |gps_km − route_km| ≤ route_km × route_tolerance_percent (15) + 0.5 km
             B  otherwise                       # detour, or a road OSM lacks — bill, log

elif route_km is not null:                       # odometer as backup, in a corridor
    floor   = route_km × corridor_floor (0.90)
    ceiling = route_km × corridor_ceiling (1.25)
    billed  = clamp(odo_km, floor, ceiling)
    grade   = B  if billed == odo_km             # inside the corridor untouched
              C  otherwise                       # clamped: hold for review

else:                                            # no trace, no pins
    billed = odo_km, grade = C
```

Then the **policy** on the rate card version:

| `distance_policy` | Effect | Default for |
|---|---|---|
| `gps_primary` | the above | walk-in tariff |
| `route_capped` | the above, then `billed = min(billed, route_km × (1 + detour_cap_percent (15)))` unless a stop was declared | corporate cards by agreement — *"you never pay for a detour"* |
| `odometer` | `billed = odo_km`; still graded and gated | legacy / contract-mandated |

**Step 6 — Persist and gate**
One `trip_distance_evidence` row per resolution (append-only; the latest is
current): every figure, quality numbers, dropped tallies, policy, grade,
matched polyline, provider, thresholds *as applied*. On the trip:
`billed_distance_km`, `distance_grade`, `distance_resolved_at`. The invoice
distance line reads *"Distance travelled (12.4 km, GPS-verified)"* — grade A
only earns the phrase; B says *"(12.4 km)"*; C never reaches an invoice.

**Grade C blocks** invoicing and the driver ledger until a permitted human
clears it with a reason (audited, `DriverSettlementRequestPolicy`'s seam).
`variance_blocks_billing` *(default true)* is the switch, as the earlier plan
proposed. Grades A and B bill automatically. `distance_variance_flagged` stays,
meaning what it means today (odometer vs GPS beyond threshold), and becomes a
column of the fleet report rather than the billing signal.

**Timing.** `TripCompleted` dispatches `ResolveTripDistance` with a delay of
`tracking.resolution_grace_seconds` *(default 120)*. `RecordTripLocations`
re-dispatches it when pings arrive for a trip already completed and not yet
billed. Walk-in settlement moves from `TripCompleted` to `TripDistanceResolved`.
An operator can force resolution from the console when a trip's pings will
never come.

**On the handset**, at Trip Completed: haversine over the buffered pings gives
`provisional_km`, priced through the *estimate* endpoint the quote screen
already uses, shown as *"provisional"*. When the outbox drains and the server
resolves, `RideComplete` shows the settled figure. A pre-submit warning fires
when the typed odometer delta disagrees with `provisional_km` beyond
`variance_threshold_percent` — which requires that threshold to reach the app,
the contract decision ADR-0035 deferred and ADR-0045 must make.

---

## 3 · Data model

| Where | Change |
|---|---|
| `trip_locations` | `+ is_mock TINYINT(1) NOT NULL DEFAULT 0` (raw DDL — partitioned table) |
| `trips` | `+ billed_distance_km DECIMAL(8,2) NULL`, `+ distance_grade CHAR(1) NULL`, `+ distance_resolved_at TIMESTAMP NULL`, `+ distance_cleared_by / _at / _reason` |
| `trip_distance_evidence` (new) | `trip_id, resolved_at, policy, grade, billed_km, gps_km, matched_km, inferred_km, route_km, odometer_km, coverage_percent, inferred_share_percent, pings_total, pings_kept, dropped (json by reason), provider, matched_polyline (mediumtext), thresholds (json), notes` |
| `rate_card_versions` | `+ distance_policy ENUM('gps_primary','route_capped','odometer') NOT NULL DEFAULT 'odometer'` — default is *today's behaviour*, so migrating changes no fare |
| `settings` catalogue, `tracking` group | `min_coverage_percent, max_inferred_share_percent, max_ping_accuracy_metres, max_plausible_speed_kph, max_teleports, gap_seconds, route_tolerance_percent, corridor_floor_percent, corridor_ceiling_percent, detour_cap_percent, resolution_grace_seconds, variance_blocks_billing` — all validated, audited, one console card |
| `settings` catalogue, `maps` group | unchanged; `osrm_base_url` points at the self-hosted box |
| ping payload (`StoreTripLocationsRequest`) | `+ pings.*.is_mock boolean nullable` |
| driver bootstrap payload | `+ tracking: { variance_threshold_percent }` (contract, ADR-0045) |

Nothing on `invoices` or `invoice_lines` changes: the line already stores
`distance_km`, and the grade is in the description. An issued invoice stays
reproducible from its own row.

---

## 4 · Components

All under `backend/Modules/Trips/Distance/` unless stated.

| Component | Responsibility | Pure? |
|---|---|---|
| `TraceCleaner` | Step 1 | yes — array in, array out |
| `OsrmMatchProvider` | Step 2 HTTP; implements `MatchProvider` | no |
| `TraceMeasurer` | drives cleaner + matcher + gap routing; yields `MeasuredTrace {matched_km, inferred_km, coverage, inferred_share, dropped, polyline}` | no |
| `RouteReference` | Step 3 via `RouteService` | no |
| `DistanceResolver` | Step 5 — `Decision {billed_km, grade, policy, …}` from the four witnesses + policy + thresholds | **yes** — the whole rule set, unit-tested exhaustively |
| `DistanceEvidence` (model) | Step 6 row | — |
| `ResolveTripDistance` (job) | orchestrates, persists, emits `TripDistanceResolved` | no |
| `TripDistanceClearanceController` (Modules/Trips) | grade-C clearance, audited | — |
| `TripPricingEngine::chargeLines()` | reads `billed_distance_km ?? distance_km` (Phase 1: still `distance_km`) | unchanged |
| `InvoiceService`, `WalkInFareService::settle()` | refuse grade C when `variance_blocks_billing` | — |
| `SettingsService::CATALOGUE` | the keys above | — |
| `mobile/src/location/GpsStreamer.ts` | `is_mock` from `LocationObject.mocked` | — |
| `mobile/src/trips/` | `provisional_km` from the buffer; pre-submit warning; provisional fare on `RideComplete` | — |
| `frontend` | tracking settings card; distance evidence panel on the trip; review queue; exceptions report | — |

`DistanceResolver` being pure is what makes this testable to the standard the
money paths carry: every branch of Step 5 is a table of inputs and an
expected `(billed, grade)`, and mutation testing on it is cheap.

---

## 5 · Sequence

Each phase is useful on its own and no phase moves money before the one
before it has produced evidence.

### Phase 0 — Operations (no code)

- Stand up **self-hosted OSRM** on the Uganda Geofabrik extract
  (`osrm-routed --algorithm mld --max-matching-size 5000`; ~1 GB disk,
  ~1.5 GB RAM, one container; a weekly rebuild-and-swap). Point
  `maps.osrm_base_url` at it. The public demo stays for laptops only.
- Queue worker running, always, in every environment. Nothing below works
  without it (ADR-0035 §Context 2).
- Set `maximum_charge_minor` on every rate row.

*Done when:* `GET /trips/{id}/route` on the driver app is served by our box,
and a completed trip's `gps_distance_km` is populated within a minute.

### Phase 1 — Shadow (backend; changes no fare)

Write **ADR-0045** first: the model in §2, the thresholds, the timing, the
supersession of ADR-0026 §2 / ADR-0031 §7, and the contract decision that
carries `variance_threshold_percent` to the app.

Then, in this order, each its own PR:

1. **Schema + settings** — the tables and columns in §3, `distance_policy`
   defaulting to `odometer`, the `tracking` keys with defaults, `is_mock` on
   the ping payload and column (accepted, stored, not yet used).
2. **`TraceCleaner` + `DistanceResolver`**, pure, with the exhaustive table
   test and a mutation pass. No HTTP yet.
3. **`OsrmMatchProvider` + `TraceMeasurer` + `RouteReference`** against
   `Http::fake()` fixtures recorded from the real OSRM box, plus one
   integration test that runs only when `OSRM_TEST_URL` is set.
4. **`ResolveTripDistance` + evidence row + `TripDistanceResolved`**, the
   grace delay, the re-dispatch on late pings, the console "resolve now".
   `reconcileAgainstGps()` keeps writing the flag until this job owns it.
5. **The exceptions report** (Reports module): grade distribution, coverage
   distribution, |gps − odometer| and |gps − route| histograms, grade-C list,
   trips with no trace. This is the instrument the flip is judged on.

*Done when:* every completed trip in staging and production has an evidence
row within `resolution_grace_seconds` + queue latency, and the report has two
to four weeks of data. **No fare has changed.**

*Flip criteria, proposed:* ≥ 85 % of trips grade A, ≤ 5 % grade C, and the
grade-A `gps_km` within ±5 % of a sane odometer on ≥ 90 % of Kampala trips. If
upcountry comes back C at a high rate, the corridor and the OSM extract are
tuned here, not after money moves.

### Phase 2 — Walk-in flips

1. `TripPricingEngine::chargeLines()` reads `billed_distance_km`, falling back
   to `distance_km` when null (unresolved trips still price as today).
2. `SettleWalkInFare` moves to `TripDistanceResolved`; refuses grade C under
   `variance_blocks_billing`; the clearance endpoint + audit.
3. Handset: `provisional_km` at completion, provisional fare on
   `RideComplete`, pre-submit odometer warning from the bootstrap threshold.
4. Console: the walk-in tariff's next version is created with
   `distance_policy = gps_primary`. That is the flip, and it is a rate-card
   version — dated, immutable, reversible by issuing another.

*Done when:* a walk-in trip's `fare_minor` derives from `billed_distance_km`,
the ledger pair matches, a grade-C trip is visibly held and clearable, and the
handset shows a provisional figure offline that converges on sync.

### Phase 3 — Corporate

1. `route_capped` on a client's card by agreement, as a new version.
2. `InvoiceService` refuses grade C; the distance line carries the grade.
3. The **evidence pack** on the trip in the console: both photographs, the
   matched trace on a map, the reference route, the four figures and the
   decision — printable, because a bank's auditor asks for paper.
4. Review queue with the two-business-day SLA PROJECT.md already promises.

### Phase 4 — Hardening

- Device integrity attestation at Trip Started; reject mock pings at
  ingestion rather than at cleaning once the flag has been observed in the
  wild for a few weeks.
- Per-vehicle odometer chain: `odometer_start ≥ vehicle's last odometer_end`,
  plausible dead mileage between trips — the fleet-management feature and the
  fraud check are the same query.
- On-device OCR of the dashboard photograph, pre-filling the reading.
- Slow-traffic minutes from the matched trace as an optional rate-card line —
  the Kampala problem, priced from evidence rather than a surge.
- Queue-health tile on the dashboard (the earlier plan's Phase 5).

---

## 6 · Testing, held to the money-path bar

- `DistanceResolver`: table-driven, every branch, plus mutation. It is the
  rule; if it is right the rest is plumbing.
- `TraceCleaner`: fixtures for jitter-while-parked, a tunnel gap, a teleport,
  a mock burst, a boda at 60 km/h — each asserting kept/dropped counts.
- `TraceMeasurer` / `OsrmMatchProvider`: recorded OSRM responses as fixtures;
  the chunk boundary (99/100/101 points); `NoMatch` mid-trace; the
  unreachable-server degradation to haversine.
- `ResolveTripDistance`: the grace delay; late pings re-dispatching; the
  console force; idempotence (a second run appends a row and updates the
  trip, never double-bills).
- End-to-end feature tests: walk-in trip → resolved → settled from
  `billed_distance_km`; grade C → held → cleared → settled; corporate → invoice
  line description carries the grade.
- Handset: `provisional_km` from a buffer fixture; the warning fires at the
  threshold and not below it; nothing derives an ETA (ADR-0031 §6).
- A **replay harness**: `php artisan trips:replay-distance {trip}` runs the
  resolver against a stored trace and prints the four figures and the grade —
  the tool used to argue with any disputed fare, and the tool used to tune
  thresholds during shadow.

Per the repository's memory: prove each guard by mutation, and drive the app
to see the provisional fare rather than trusting a green test.

---

## 7 · Decisions the owner still makes

The big one is made: measured, not odometer. What remains, each recorded in
ADR-0045:

1. **The default thresholds** in §2 — accept the proposals, or name others.
   All are settings; the defaults are what ships.
2. **Grade C on a walk-in** — held with no fare shown, or a *provisional
   lower-bound* fare paid to the driver now and adjusted on clearance? The plan
   proposes the latter: a driver who has done the work is paid something
   defensible today.
3. **Who clears** — Finance (MFA) via `DriverSettlementRequestPolicy`'s seam,
   or a new permission.
4. **The Bank's contract wording** — `route_capped` is an offer, not a switch;
   their card flips when they sign.
5. **Where the OSRM box lives** — beside the API server or on its own VPS.

---

## 8 · Deliberately not in this plan

- Removing odometer capture. It stays: fleet mileage, the photograph, the
  backup witness.
- Passenger-facing surge. Predictability is what a corporate client buys and
  transparency is the walk-in differentiator; incentives stay on the driver
  side (ADR-0036).
- Google as the reference engine. It bills per request on a call made for
  every trip; OSRM is free and already wired. Google remains an option for
  traffic-aware ETAs on the map (ADR-0031), which is a different job.
- Real-time metering, or an ETA the app computes itself (ADR-0031 §6).
- Touching issued invoices; a credit note is how a wrong one is corrected.

---

## 9 · The earlier plan's §8 questions, answered

| §8 asked | This plan answers |
|---|---|
| **What "fixed routing" prices** — the planned road, or the driven trace snapped to roads? | **The driven trace, snapped to roads** (Step 2). The planned road is the *reference* (Step 3): it bounds the odometer when the trace is weak, grades a trustworthy trace, and under `route_capped` caps a detour for clients who buy that. Which of the two a passenger pays for is therefore a rate-card term, not a constant. |
| **What a "dynamic time factor" is a factor of** | Time is **never a multiplier on distance**. Waiting stays a separate line from `trip_events` with its free allowance; the night window stays a tariff; a future *slow-traffic minutes* line (Phase 4) is measured from the trace outside declared waiting, so the same minute cannot be billed twice. |
| **How two inputs resolve when they disagree** | Step 5: a trustworthy trace wins outright; a weak trace hands over to the odometer *inside a corridor the road defines*; no evidence at all is grade C and held. `lesser_of`'s conservatism survives as the corridor floor and the grade-C provisional lower bound. |
| **Whether a driver can reproduce their own pay from what the app showed them** | The handset shows a provisional figure from its own buffer at the kerb; the evidence row stores every input and threshold; `trips:replay-distance` reproduces the decision from stored data. A driver disputing a fare is shown four figures and a grade, not an opinion. |
| **What it costs per trip** | Two or three OSRM calls per completed trip on a self-hosted box: **zero marginal cost**. Google is not on this path. |
