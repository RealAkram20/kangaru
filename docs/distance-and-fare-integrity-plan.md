# Distance and fare integrity — an enterprise plan

**Status:** proposal. Nothing here is built. **One of §6's five decisions has
been ruled** — decision 2, on 2026-08-18; the answer was "use both figures", it
supersedes §4 Phase 2's dial before it was built, and it is written out in §8.
The other four are still open.
**The unit §8 declined to design is now planned** in
`docs/measured-distance-plan.md` (2026-08-18, later the same day): the trace is
primary, the road-routed reference is the check, the odometer is the backup
witness. Its §9 answers §8's five questions one by one.
**Scope:** both billing paths — corporate invoicing and walk-in fares.
**Written:** 2026-08-15, after a UGX 198,013,800 fare reached the driver ledger
from a single mistyped odometer digit.

Everything in §1 and §2 was verified against the code and the live database
rather than assumed. Where something is a proposal it says so.

---

## 1. What already exists

This platform is not missing a distance-integrity design. It has a good one.
Most of this plan is about **switching on, bounding and exposing what is
already built** rather than inventing a new mechanism.

### 1.1 One pricing engine, two callers

`Modules\Billing\Pricing\TripPricingEngine::price()` is the single definition
of what a trip costs. Both paths call it:

| Path | Caller | Result |
|---|---|---|
| Corporate | `InvoiceService::generate()` | an `Invoice` with immutable lines |
| Walk-in | `WalkInFareService::settle()` | `trips.fare_minor`, then the driver ledger pair |

That shared engine is the plan's biggest asset: **a rule added there applies to
corporate and walk-in at once**, and the two cannot drift into disagreeing
about what a kilometre costs.

### 1.2 The rate card is already rich

`rate_card_rates` (and `rate_card_zone_rates`) carry, per vehicle category and
per zone:

`base_fare_minor`, `per_km_minor`, `per_waiting_minute_minor`,
`minimum_charge_minor`, **`maximum_charge_minor`**

plus, on the version: `free_waiting_minutes`, `night_starts_at` /
`night_ends_at` / `night_multiplier_bp`, `rounding_mode`, and `locked_at` for
immutability.

`maximum_charge_minor` is implemented in `TripPricingEngine::chargeCapAdjustment()`,
validated in `StoreRateCardVersionRequest`, rendered by `RateCardsPage`
("Uncapped" when null) and editable in `RateCardVersionDialog`'s **Maximum**
field.

### 1.3 GPS measurement is already built

- `trip_locations` — every ping, partitioned by month, retention configurable
- `RouteDistanceCalculator` — haversine over consecutive points, with a
  configurable noise floor so a parked vehicle's receiver drift is not billed
- `TripStateMachine::reconcileAgainstGps()` — writes `gps_distance_km` and sets
  `distance_variance_flagged` when the two distances disagree beyond a threshold
- PROJECT.md states the requirement and a success metric: flagged trips
  reviewed within two business days

### 1.4 Admin settings have a real architecture

`SettingsService::CATALOGUE` is the law — a group/key absent from it cannot be
written. Values are validated, cached, audited, and secrets are encrypted and
write-only. `SystemSettingsPage` renders ten cards over it.

---

## 2. What is actually wrong

Six findings. All verified.

### 2.1 The whole GPS pipeline was inert — no queue worker

`QUEUE_CONNECTION=database` and nothing was consuming the queue.
`RecordTripLocations` jobs sat at `attempts=0` indefinitely.

`trip_locations` held **7 rows**. After draining the queue: **726**.

Consequence chain:

```
pings captured ✅ → POSTed, 202 ✅ → job queued ✅
  → no worker ❌ → trip_locations empty
  → kilometresFor() returns null → reconcileAgainstGps() returns early
  → gps_distance_km NULL, distance_variance_flagged 0
  → every odometer reading ever entered went unchecked
```

The same worker also had stuck `TripOfferedNotification` jobs, so drivers were
not being pushed job offers either.

**This is the most important finding in this document.** The control was not
missing, not misconfigured and not wrong — it simply never ran, and nothing
anywhere said so.

### 2.2 `maximum_charge_minor` is NULL on every rate row

All 8 rows across all 3 rate card versions are uncapped. The cap that would
have contained the 198M fare exists, works, and has never been set.

### 2.3 The odometer has a floor but no ceiling

`TripStateMachine` line 131:

```php
$trip->distance_km = (string) ($trip->odometer_end - $trip->odometer_start);
```

A test covers `odometer_end < odometer_start`. Nothing covers an absurdly large
delta. Trip 32 recorded 90,004 km; trips 16 and 17 hold 89,859 km and 62,290 km.

### 2.4 The fare is priced from the odometer, and GPS is only a watchdog

`TripPricingEngine::chargeLines()` reads `$trip->distance_km` — the
driver-entered figure. `gps_distance_km` never enters the arithmetic. So even
with reconciliation working, a driver inflating by under the threshold is paid
on the inflated number.

### 2.5 The flag is a report, not a gate

Nothing consults `distance_variance_flagged` before invoicing a corporate trip
or before writing the driver's ledger pair. A flagged trip bills normally.

### 2.6 Admins cannot set the controls that matter

| Control | Where it lives now | Admin-settable? |
|---|---|---|
| `variance_threshold_percent` | `config/tracking.php`, env | **No** |
| `min_segment_metres` | `config/tracking.php`, env | **No** |
| retention, partitions, live TTL | `config/tracking.php`, env | **No** |
| `driver_commission_percent` | settings catalogue | API only — **no UI card** |
| `bonus_*` | settings catalogue | API only — **no UI card** |
| rate card min/max, night, zones | rate card version | Yes |

The `billing` settings group has no card in `SystemSettingsPage` at all.

---

## 3. The principle

> **Separate what the vehicle did (measurement) from what we charge (policy),
> and put every threshold in the admin's hands.**

The odometer is not wrong to exist. This is a fleet platform as well as a
ride-hailing one: an anchor client asked for dashboard photographs, and an
office needs vehicle mileage for fuel, servicing and accountability for a
company car. That is a genuine requirement and it stays.

What is wrong is the odometer being **the unchecked source of truth for money**.

Bolt, Uber and SafeBoda price from the measured trace and never ask a driver to
type a distance. This platform should be able to do the same **where it makes
sense** — and keep odometer billing where a corporate contract requires it.
That is a policy dial, not a rewrite.

---

## 4. The plan

Five layers, ordered so that each is useful on its own and the cheapest, most
protective work lands first.

### Phase 0 — Stop the bleeding (no code, do today)

1. **Run a queue worker, always.** In development and production. Nothing in
   §1.3 functions without it.
2. **Set `maximum_charge_minor` on every rate row.** Available in the admin UI
   right now. A sedan cap of, say, UGX 500,000 makes a 198M fare arithmetically
   impossible regardless of anything else in this plan.

Both are zero-code and remove the acute risk.

### Phase 1 — Bound the input (small, high value)

- **A hard sanity ceiling on the odometer delta**, enforced in the transition
  request so a bad reading never becomes a trip, let alone a fare.
- **Reject, with a legible error**, rather than flag: a driver who mistypes at
  the kerb can retype in five seconds. Only they can correct it cheaply.
- **Warn in the driver app before submit** when the entered delta disagrees
  with the trip's own buffered GPS distance beyond the threshold. The handset
  already holds the pings, so this costs nothing and catches the typo at the
  only moment it is free to fix.

### Phase 2 — Make the policy explicit and per-contract

Add a **distance source** to the rate card version, so corporate and walk-in
can legitimately differ:

| Source | Meaning | Fits |
|---|---|---|
| `odometer` | bill the driver-entered reading | corporate contracts that require it |
| `gps` | bill the measured trace | walk-in rides — the Bolt model |
| `lesser_of` | bill whichever is smaller | conservative, dispute-proof |
| `greater_of` | bill whichever is larger | almost never right; included for completeness |

It belongs on the **rate card version** rather than in global settings because
it is a commercial term: one client's contract may specify odometer billing
while the public walk-in tariff prices on measured distance. Versioned rate
cards already give it immutability, so changing the policy tomorrow cannot
restate an invoice issued today.

### Phase 3 — Turn the flag into a gate

- A trip with `distance_variance_flagged` **cannot be invoiced** and **cannot
  settle to the driver ledger** until a human with the right permission clears
  it.
- Clearing is an audited act with a reason, like every other money act here.
- A **review queue** in the dashboard — this is what PROJECT.md's "reviewed
  within two business days" metric is measured against, and there is currently
  no surface to review anything on.
- Whether the gate is hard (blocks) or soft (warns) should itself be an admin
  setting, defaulting to **hard** — controls default on.

### Phase 4 — Give admins the controls

**A new `tracking` settings group** in `SettingsService::CATALOGUE`, with a
card in `SystemSettingsPage`:

- `variance_threshold_percent`
- `odometer_max_km_per_trip`
- `min_segment_metres`
- `variance_blocks_billing` (the Phase 3 switch)

**A `billing` card** for the group that already exists and has no UI:
`driver_commission_percent`, `bonus_enabled`, `bonus_weekly_trip_target`,
`bonus_weekly_amount_minor`.

Moving a value from `config/tracking.php` into the catalogue is a real
migration, not a copy: the config reads must be replaced by settings reads, and
the env vars should keep working as the default so an existing deployment does
not change behaviour on upgrade.

### Phase 5 — Make silence impossible

The lesson of §2.1 is that the failure was **invisible**. It produced no error,
no flag and no empty screen — just quietly missing evidence.

- **Queue health on the dashboard**: oldest pending job age, failed job count.
  A worker that stopped an hour ago should be visible on the screen an operator
  already looks at.
- **A distance exceptions report**: trips with no GPS trace, trips flagged,
  trips where the two figures disagree by more than a chosen margin.
- **Alert when a completed trip has no GPS trace at all** — today that is
  silently treated as "not the driver's fault" and left unflagged, which is
  right as a judgement and wrong as a silence.

---

## 5. Corporate vs walk-in, side by side

| | Corporate | Walk-in |
|---|---|---|
| Trip origin | `Booking` | `OrderRequest` |
| Priced by | `InvoiceService` → `TripPricingEngine` | `WalkInFareService` → `TripPricingEngine` |
| Paid by | company, on an immutable invoice | passenger, in cash |
| Driver effect | none directly | ledger pair, commission split |
| Odometer matters because | fuel, servicing, vehicle accountability, contractual evidence | it should not — the rider expects a measured fare |
| Recommended `distance_source` | `odometer`, with GPS as a gate | `gps` |
| Dispute cost | high — a corporate client audits invoices | high — a driver disputes their pay |

The single pricing engine means both get every guard added at Phase 1 and
Phase 3 automatically. Only Phase 2's dial distinguishes them, which is
exactly where the difference is genuinely commercial rather than technical.

---

## 6. Decisions the owner must make

Each of these needs an ADR, because each supersedes something already decided.

1. **The odometer ceiling.** A single global maximum, or per vehicle category?
   A truck's plausible day is not a boda's.
2. ~~**Default `distance_source` for walk-in.** `gps` is the recommendation.~~
   **Ruled by the owner on 2026-08-18, and the answer is neither option: use
   both.** See §8 — the ruling asks for something this plan did not offer, so it
   is written out there rather than compressed into a table cell here.
3. **Hard gate or soft gate** on a flagged trip, and who may clear it. Finance
   already requires MFA because those roles move money;
   `DriverSettlementRequestPolicy` is the existing seam.
4. **Whether corporate clients are told** their invoices are now
   GPS-reconciled. It is a selling point and a contractual change.
5. **What happens to the trips already in the database** carrying impossible
   distances — corrected, voided, or left with a flag.

---

## 7. What this plan deliberately does not propose

- **Removing the odometer.** It is an anchor-client requirement with a real
  fleet-management purpose, and the dashboard photograph is evidence no GPS
  trace replaces.
- **A paid distance API.** `RouteDistanceCalculator` measures the actual trace
  the vehicle drove, which is better evidence than any route service's opinion
  of how far it should have been, and costs nothing.
- **Real-time fare metering.** A running meter is a different product with
  different failure modes; nothing here needs it.
- **Touching issued invoices.** They are immutable by design. A wrong invoice
  is corrected by a credit note, which `CreditNoteService` already implements.

---

## 8. The pricing unit — ruled on 2026-08-18, and deliberately not designed here

**Recorded because the owner asked for it to be recorded, and because a ruling
that lives only in a chat log is a ruling that gets re-litigated.** This section
states what was decided and what was not. Nothing in it is built.

### What the owner ruled

Asked to choose between pricing from the odometer, pricing from the GPS trace,
or deferring, they chose **none of the three: price from both.**

> *"can we have both, for a better Pricing we will be referreing the both the
> Distance and the Odometer we are looking at developing a better 'in-app
> algorithm using fixed routing and dynamic time factors' … and we talk time to
> develop this one specific unite becasue it take about 85% of the system
> value"*

Four things follow, and each is the owner's, not this document's:

1. **Both figures are inputs.** The measured trace and the odometer reading both
   feed the fare, rather than one being the source and the other a watchdog.
   §2.4's complaint — that `gps_distance_km` "never enters the arithmetic" — is
   answered by putting it *in* the arithmetic, not by swapping which number wins.
2. **The instrument is an in-app algorithm** over **fixed routing** and
   **dynamic time factors**, not a `distance_source` switch. §4 Phase 2's
   four-value dial is therefore **superseded before it was built** — it was the
   right shape for "choose one figure" and the wrong shape for "combine two".
3. **It is its own unit of work, and its schedule is a separate conversation.**
   The owner asked to *talk time* on it rather than to start it.
4. **The owner values it at roughly 85% of the system.** That is their estimate
   and it is recorded as theirs. It is also the reason this section refuses to
   sketch a design: a unit carrying that much of the product earns a real
   scoping pass and an ADR, not a paragraph written by whoever happened to be
   fixing a screen.

### What this changes today: nothing

Until that unit is designed and built, **the fare is still priced from the
odometer** (`TripPricingEngine::chargeLines()` reads `$trip->distance_km`), and
the GPS trace is still only a review signal. Everything in §2 that is unfixed
stays unfixed — in particular §2.2, **`maximum_charge_minor` is still NULL on
all 8 rate rows**, which is the one guard available today at zero code and is
independent of every ruling above.

### The questions the unit will have to answer

Listed so the scoping conversation starts from something, and explicitly **not
answered here**:

- **What "fixed routing" prices.** The planned road distance between the two
  points, or the driven trace snapped to roads? `RouteDistanceCalculator`
  measures what the vehicle did; ADR-0031's routing engine knows what the road
  is. They disagree whenever a driver detours, and which one the passenger pays
  for is a commercial answer, not a technical one.
- **What a "dynamic time factor" is a factor of.** Waiting time is already
  billed from `trip_events` and already has a free allowance; a time *factor*
  on top of a per-km fare is a different charge and must not silently
  double-bill the same minutes.
- **How two inputs resolve when they disagree** — which is the normal case, not
  the exception. This is where §4 Phase 2's `lesser_of` reasoning survives even
  though its dial does not.
- **Whether a driver can reproduce their own pay from what the app showed
  them.** `PRODUCT.md`'s claim is audit-grade correctness; an algorithm a driver
  cannot check is a dispute generator regardless of how fair it is.
- **What it costs per trip.** ADR-0031 already records that a naive
  thirty-second routing poll runs to roughly $900 a month at a hundred trips a
  day. Any per-trip routing call belongs in that arithmetic before it is
  designed in.

**Nothing here supersedes ADR-0035**, which stands: the ceiling still refuses an
impossible reading at the transition, and the odometer still exists for fuel,
servicing and the anchor client's evidence trail (§3, §7).
