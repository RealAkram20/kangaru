# ADR-0071: An approved booking offers itself

**Status:** Accepted — 6 September 2026

**Depends on:** ADR-0009 (allocation rules), ADR-0020 (the ranking must be
auditable), ADR-0024 §3–§7 (the offer, its clock, and the rule that a ride for
later is not offered now), ADR-0055 §6–§7 (`forActor` scoping, and what a null
`operator_id` means), ADR-0064 (three services on a booking), ADR-0067 (the
main fleet needs no contract), ADR-0068 (a desk assignment rings the driver).

**Amends:** the assumption — never written down, which is how it survived —
that a booking reaches dispatch because a person puts it there.

## Context

Reported from production on 6 September: *"the automatic dispatch is not
working… when I create the booking it's automatically approved, and when it is
done I still have to go to Dispatch and assign the vehicle and the driver."*

Nothing was broken. The platform had never carried a booking into dispatch at
all. `BookingService::approve()` raised `BookingApproved`, whose only listener
emailed the requester; neither that service nor any booking controller
referenced `DispatchOfferService`. Automatic dispatch had exactly two entry
points, and a booking is in neither:

1. **Walk-in order requests** — `OrderRequestService::offerToDrivers()`, on by
   default since ADR-0024.
2. **Advancing an offer that already exists** — a decline, or the ten-second
   `dispatch:advance-offers` sweep, which only touches bookings that already
   carry a lapsed offer.

So a booking entered the automatic loop only *after* a human had made the
first assignment. Every part of the machinery was running and healthy; it had
no door a booking could come through.

**A second fault sat behind the first**, and would have made this ADR's fix do
nothing. `offerWaveForBooking` scopes its candidates with
`offerableForFleet($booking, $booking->operator_id)`, and a booking's
`operator_id` is null until a fleet takes the job — the
`add_operator_to_the_fleet` migration says so in as many words: *"NULL means
Kangaru's, unclaimed"*. `forBookingInFleet` renders a null operator as
`drivers.operator_id IS NULL`, which is the correct reading of an **actor**
from head office and the wrong reading of a **booking** nobody has claimed:
`drivers.operator_id` is NOT NULL by schema, so that predicate cannot match a
single driver, ever. Every automatic wave for an unclaimed booking returned an
empty set in silence — including the rotation after a decline, which means a
declined corporate job had already been dying quietly rather than rolling to
the next driver.

## Decision

### 1. Approval is the door

`BookingApproved` gains a second listener,
`Modules\Dispatch\Listeners\OfferApprovedBookingToDrivers`, which opens an
offer wave for the booking.

A listener rather than a call, and in `Modules\Dispatch` rather than
`Modules\Bookings`, for the reason `TripCompleted` already records: the
raising module must not learn who acts on the event. `BookingApproved` exists
precisely so `Modules\Bookings` need not know that anybody sends
notifications, and it must not now learn that anybody dispatches either.

### 2. An offer wave, not `autoAssign`

`POST /bookings/{id}/auto-assignment` already commits the top suggestion
unattended, behind `dispatch.automatic_enabled`. This is deliberately *not*
that.

The distinction is not who hears about it — since ADR-0068 both ring, because
`DispatchService::assign` hands a driver with a handset to
`offerBookingToChosen()`. The distinction is what has already been decided
when the phone rings. `autoAssign` commits one choice; a wave commits nothing,
asks the ranked drivers in turn, rolls on by itself when one declines, and
becomes a trip only when somebody answers. **The weaker act is the one that
may be taken unattended, and it must not require enabling the stronger one**,
which is why `automatic_enabled` is left alone and off.

Because the offer carries `vehicle_id`, an accept writes a fully assigned
trip — both halves the desk was doing by hand.

### 3. Only bookings that are wanted now

A booking whose `scheduled_for` is in the future is left alone. This is
ADR-0024's rule word for word, and for its reason: deciding how early to start
looking for tomorrow's 06:00 airport run is a scheduler's job, deferred by
name, and guessing at it here would hold an offer open overnight and burn
every driver's rotation against a job nobody can start.

The test is `isFuture()`, **not** "has a scheduled time". A booking raised for
14:00 that a human approves at 14:20 is wanted now; a null test would send it
to the board alongside next Tuesday's, which is the same silent wait this ADR
exists to end.

### 4. An unclaimed booking narrows to no fleet

`offerableForFleet` no longer asks for fleetless drivers when a booking has no
operator. An unclaimed booking narrows to no fleet at all, and the commercial
filter that was always there — `contracted || mainFleet` — decides who may
take it.

That filter is the whole safety argument, and it is not new: `contracted` is
this client's own contracted vehicles, and `mainFleet` is ADR-0067, the
owner's ruling of 29 August that Shanitah takes corporate work it holds no
contract for. **Another operator's free, nearby, perfectly capable van stays
unofferable**, which is the case `MainFleetDispatchTest` guards from the
desk's side and `ApprovedBookingOffersItselfTest` now guards from the
scheduler's — the side that acts with nobody watching.

### 5. Behind a flag, on by default

`dispatch.booking_auto_offer` (`DISPATCH_BOOKING_AUTO_OFFER`), default true.

AGENTS.md requires a flag for dispatch changes, and this one needs a kill
switch on its own merits: it is the only thing on the platform that makes a
stranger's phone ring without a person deciding it should.

Default **on**, which departs from `automatic_enabled`'s caution and is worth
stating rather than assuming. That flag is off because a matcher *deciding*
unattended on accounts with commercial agreements behind them is a risk taken
on somebody else's behalf. This one only *asks*, the driver may decline, the
desk can still assign by hand, and shipping it off would ship exactly the
feature nobody can use that ADR-0024's own note warns against. The owner asked
for the behaviour; the switch is there for when it misbehaves.

### 6. Failure is swallowed

The listener catches everything and logs `dispatch.booking_offer_failed`.

The approval has already committed — this runs after the transaction, as the
notification does — so a throw would answer the approver with a failure for a
decision that *did* happen and leave them re-approving an approved booking.
Every failure mode degrades to the behaviour of the day before this shipped: a
booking on the board, and a dispatcher who assigns it.

## Consequences

- A booking now reaches a driver's phone with nobody opening Dispatch, which
  is what was asked for.
- **The decline rotation starts working on corporate bookings**, which is a
  larger change than it looks and was not asked for: it has been silently
  dead for every unclaimed booking, and desk-assigned jobs that a driver
  declined were reaching nobody.
- The desk keeps every power it had. An offer is a question; until somebody
  answers, the booking is still theirs to reassign.
- A booking with no dispatchable driver behaves exactly as before — approved,
  on the board, waiting. On the day this was written that was every booking on
  production: two drivers on duty, both with positions ~45 hours old against a
  180-second TTL, so `dispatchable()` returned nothing and there had been no
  offers in 24 hours. **This ADR does not fix that**, and it is worth naming
  because it will look like this feature failing. It is a fleet and handset
  question, not a code one.
- Scheduled bookings still need a human, or the scheduler ADR-0024 defers.
