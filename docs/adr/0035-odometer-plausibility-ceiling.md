# ADR-0035: An odometer plausibility ceiling, and the admin's dials

**Status:** accepted
**Date:** 2026-08-15
**Supersedes:** nothing. Extends AGENTS.md § Odometer Capture and the
`tracking` half of ADR-0003.
**Related:** `docs/distance-and-fare-integrity-plan.md` (Phases 1 and 4)

## Context

A driver ended a trip with an opening reading of 10001 and typed 100005 for
the closing one — one digit too many. The platform recorded a 90,004 km
journey, priced it through the ordinary rate card at
**UGX 198,013,800**, and wrote the pair to the driver's ledger. Nothing
objected at any point.

Three separate controls should have caught it and none did:

1. **The odometer had a floor but no ceiling.** `TransitionTripRequest`
   refuses a closing reading below the opening one. There was no equivalent at
   the other end, and `TripStateMachine` computes `distance_km` as a plain
   subtraction.

2. **The GPS variance flag never ran.** Ingestion is asynchronous (ADR-0003)
   and no queue worker was running, so `trip_locations` was empty,
   `RouteDistanceCalculator::kilometresFor()` returned null for want of two
   points, and `reconcileAgainstGps()` took its early return. That leaves
   `gps_distance_km` null and the flag false — **indistinguishable from the
   legitimate "this trip has no GPS evidence" case**, which is what made it
   invisible.

3. **The rate card's `maximum_charge_minor` was null**, as it is on every rate
   row. The cap is implemented and editable in the console; nobody had set one.

The flag is also the wrong instrument for this. It compares against a trace,
declines to judge when there is no trace, and is a *review signal* rather than
a refusal — so it can never stop an impossible reading on a trip with no pings.

Separately, the threshold behind PROJECT.md's success metric ("flagged trips
reviewed within two business days") lived in `config/tracking.php` behind an
env var. Changing it needed a deploy, it appeared nowhere in the console, and
it was not audited — while `driver_commission_percent` and the bonus scheme
sat in the settings catalogue with no admin UI at all.

## Decision

**1. A ceiling on the odometer delta, refused at the transition.**

`TransitionTripRequest` gains a check beside the existing floor: a closing
reading that puts the journey beyond `tracking.odometer_max_km_per_trip` is a
422, and the trip does not move to Trip Completed.

Refused, not flagged, and refused *there*: past it the reading becomes a trip,
then a fare, then a ledger entry or an invoice line, and correcting it means
unpicking money.

**How this reaches a driver, honestly.** The driver app does not send the
transition — it queues it through the offline outbox (ADR-0023), because the
whole app is built for dead zones. So the 422 arrives on a later drain and
**parks** the item with the server's message attached, which the sync queue
screen shows. The driver reads it there, not at the kerb.

That is the existing design working (ADR-0023 §6 requires a refused update to
keep its payload and be shown), and it still prevents the bad fare — which was
the point. But it means the message must name the figure and the limit and be
legible out of context, because by then the dashboard is not in front of them.
A console user, who posts synchronously, sees it immediately.

**The pre-submit warning in the app is therefore not built.** See below.

The two odometer errors cannot both fire — a reading below the opening one
makes the distance negative, which cannot exceed a positive ceiling — so
nothing guards against double-reporting. A first draft did guard on
`errors()->has()`; a mutation pass showed the guard was dead code and it was
removed rather than shipped with a comment claiming it did something.

**2. A `tracking` settings group, so both numbers are the operator's.**

`variance_threshold_percent` moves out of `config/tracking.php` and
`odometer_max_km_per_trip` joins it. Both are validated, cached, audited and
editable in the console like every other setting. Defaults match what shipped
(10% and 2,000 km), so no deployment changes behaviour until somebody decides
it should.

**3. The `billing` group gets the console card it never had.**

`driver_commission_percent` and the three bonus keys have been in the catalogue
since ADR-0029 and ADR-0034 and reachable only by API.

## What is deliberately *not* in settings

`min_segment_metres`, `retention_months`, `partitions_ahead`,
`live_ttl_seconds` and `live_stale_after_seconds` stay in
`config/tracking.php`.

These are engineering tuning, not operator policy. No office has an opinion
about a GPS noise floor, and putting one in an admin form is an invitation to
break distance measurement for the whole fleet — on the very figure that
checks the odometer. The distinction is whether a number expresses a business
rule (it belongs in settings) or a property of the measurement apparatus (it
does not).

## Why 2,000 km

Deliberately generous: far beyond any single journey this platform dispatches,
so it catches mistyped digits rather than adjudicating long-distance work. It
would have refused the 90,004 km reading forty-five times over.

An operator running genuine cross-border work should raise it; one running
Kampala city work only can drop it a long way and catch far more. That it is
settable is the point — the right number is a fact about a fleet, not about
this codebase.

## Deliberately not built: the pre-submit warning in the driver app

The plan proposed warning the driver *before* they submit, by comparing the
typed delta against the trip's own buffered GPS distance. That is still the
right feature and it is not here, because the ceiling is a **server setting**
and the handset does not know it.

Hardcoding it in the app is the exact defect this repository has already
recorded once: a threshold shipped inside a handset goes on asserting the old
number after the office changes it, on devices nobody can reach. Fixing that
properly means deciding which payload carries the ceiling to the app, which is
a contract decision rather than a line of validation.

Until then the server guard is the whole control, and it works — it just
speaks through the parked queue rather than the keypad.

## Consequences

- A console user who mistypes is told immediately, in kilometres. A driver is
  told on the next sync, on the queue screen, with the same message — which is
  why the message names the figure and the limit rather than saying "invalid".
- **This does not make the platform's distances trustworthy.** It removes a
  class of typo. A driver inflating a 6 km trip to 13 km is well inside any
  plausible ceiling, and only the GPS variance flag sees that — which needs a
  queue worker running, and is still only a review signal. Two trips in the
  development database are flagged exactly this way.
- **The fare is still priced from the odometer**, not the measured trace.
  Changing that is Phase 2 of the plan and needs its own decision, because it
  changes what a client is invoiced and what a driver is paid.
- **A flagged trip still bills normally.** Phase 3.
- `TRACKING_VARIANCE_THRESHOLD_PERCENT` becomes inert. The config entry is left
  in place documenting where the value went, because silently ignoring an env
  var somebody set is worse than saying so.
- `TripStateMachine` now depends on `SettingsService`. It is resolved through
  the container, so every existing caller is unaffected.
