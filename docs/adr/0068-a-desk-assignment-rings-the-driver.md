# ADR-0068: A desk assignment rings the driver

**Status:** Accepted — 29 August 2026

**Depends on:** ADR-0009 (allocation rules and the override reason),
ADR-0016 (a driver profile need not have a sign-in account), ADR-0020
(the ranking must be auditable), ADR-0024 §3–§7 (the offer, its clock, and
what a driver may be told before accepting), ADR-0046 (the ring, its channel
and the wake-up push), ADR-0055 §6 (`forActor` is how a fleet's pool is
scoped), ADR-0064 (three services on a booking), ADR-0067 (the main fleet
needs no contract).

**Amends:** ADR-0024's assumption that the offer pipeline is for walk-ins
only, and the reasoning recorded on `NotificationType::DRIVER_TRIP_ASSIGNED`,
which argued that a desk assignment is *the desk's decision* and therefore
does not earn an interruption.

## Context

The platform has had two ways to put work in front of a driver, and they gave
completely different experiences.

A **walk-in order** went through `dispatch_offers`: the driver's phone rang on
`offers.call.v2`, a full-screen Accept/Decline appeared over the lock screen,
a clock ran, and a decline or a timeout rolled the job to the next driver.

A **corporate booking assigned from the desk** created the trip immediately
and sent one quiet notification — `DriverTripAssignedNotification`, with no
`channelId` and no sound, which Android therefore delivered on the default
channel at ordinary importance. Nothing rang. Nothing badged. The trip
appeared in the Upcoming list for the driver to stumble on.

On 29 August the owner dispatched a delivery from the admin and watched it
reach the driver as nothing at all:

> *"the order request did not come in the way it should, the notification did
> not go through, not even the notification page, we just went straight to
> the trip details."*

The database agreed: `dispatch_offers` had an `order_request_id` and no
`booking_id`, so a booking was **structurally incapable** of producing an
offer. The ringing experience had never been available to the desk's own
work. Asked what the two channels should look like, the owner was explicit:

> *"we need the same experience throughout… the same experience we have for
> the walk-in."*

## Decision

**1. A booking is an offer's second owner.** `dispatch_offers.booking_id`
joins `order_request_id`, both nullable, exactly one set —
`create_dispatch_offers_table` anticipated this in writing ("when a
booking-shaped offer arrives it is a sibling column, not a reinterpretation
of this one"). The exclusivity is asserted in `DispatchOffer::booted()`,
where the mistake is legible, rather than by a check constraint nobody reads.

**2. `DispatchService::assign` asks instead of telling.** Every check it made
still runs, and runs first — the booking transition, the service type
(ADR-0064 §4), the allocation rules and their override reason (ADR-0009),
leave and workshop availability (ADR-0017). What changes is what happens once
they pass: the chosen driver is *rung*, and no trip exists until they accept.

**3. A driver with no sign-in account is still assigned outright.** ADR-0016
allows a driver profile with no user, and fourteen of the twenty on the demo
fleet are in that position. There is no handset to ring, so an offer would
expire unanswered and roll to somebody else — turning "assign Musa" into
"assign anybody but Musa". Those keep today's behaviour and the desk
telephones them, which is what it did before any of this existed.

**4. The endpoint answers 202 or 201, and they mean different things.** A 202
carries a `DispatchOffer`: accepted, a phone is ringing, the trip does not
exist and may never. A 201 carries a `Trip` and means the driver has no app.
`DispatchService::assign` returns `Trip|DispatchOffer` — a union rather than a
flag, because the caller has to render two different things and must not be
able to forget which it got.

**5. A decline or a timeout rolls to the next driver.** The owner's ruling,
chosen over sending the booking back to the board. Rotation reuses
`DispatchRecommender`, filtered exactly as `autoAssign` is — contracted
vehicles, or the main fleet (ADR-0067). A rotation that reached for any free
van would hand a client's contracted work to somebody else's vehicle
unattended, which is worse than doing it on a board somebody is watching.
When no candidate remains the booking is simply unassigned again, which is
where the desk left it.

**6. The scheduler needs a pool without an actor.**
`DispatchRecommender::forBooking` scopes candidates through
`Driver::forActor`, and `dispatch:advance-offers` has no request and no
session. `forBookingInFleet(Booking, ?int $operatorId)` is the same ranking
asked on behalf of a fleet, and the two doors agree by construction: for
fleet staff `forActor` reduces to `operator_id = $actor->operator_id`, and
for head office to `operator_id IS NULL`.

**7. The trip's tenant comes from the booking, not from the request.**
`BelongsToTenant` fills `tenant_id` from the ambient `TenantContext`, which
was right while the desk was pressing the button. The trip is now written
inside the *driver's* request, and a driver belongs to no client — so an
ambient fill would produce a corporate trip owned by nobody. This is the
cross-tenant leak ADR-0001 calls the worst bug available, reached by a route
nothing was watching, and it is taken from `bookings.tenant_id` for the same
reason `operator_id` is taken from the driver: it is the source that is
always right.

**8. The override reason rides on the offer.** ADR-0009 requires a written
reason when a dispatcher passes over a contracted vehicle, and `trips` has
always stored it — it could, because the press created the trip. The press
now creates an offer and the trip appears minutes later, so
`dispatch_offers.allocation_override_reason` holds it in between. Only round
one can carry one: it is the reason a *person* gave for a pair they chose,
and a rotation wave is filtered to vehicles that need no override.

**9. A corporate accept stops at `accepted`.** A walk-in's accept continues
straight to `driver_en_route`, because saying yes to a passenger standing at
a kerb *is* setting off. A booking may be for Tuesday at four. The rule was
already written down in `DispatchOfferService::accept`; ADR-0068 changed
which door such a trip arrives through, not the rule.

**10. `driver.trip.assigned` survives, and almost never fires.** The enum
case stays — delivered rows carry it — and the listener now returns early
when the booking has any offer, because a driver who was *asked* must not be
*told* a second later. What remains is the phone-only path in §3.

## Consequences

The desk no longer gets a trip the instant it presses Assign; it gets a
ringing driver, and the trip appears when they answer. That is a visible
change to the dispatch board and to the API contract, and it is the point of
the change rather than a side effect of it.

One pipeline now carries both channels, so the ring, the channel, the
wake-up push, the withdrawal, the countdown and the call screen have exactly
one implementation. The driver app needed no new push routing at all: it
already routes on `offer_id`.

A booking can now sit in `approved` with a live offer against it, which is a
state the board has to render — "ringing" is derived from live offers rather
than stored, following `searchState()`'s own reasoning that a cached copy of
a fact is a copy that goes wrong.

The risk this accepts: a desk assignment can now fail to stick. A driver who
declines, or whose phone is face-down, sends the job into rotation, and a
dispatcher who assumed "assigned" now has to watch the board. That is the
same bargain the walk-in queue has always made, and the owner made it
knowingly.

## Alternatives Considered

**Ring the assignment notification, keep the trip.** Give
`DriverTripAssignedNotification` the offer channel, the ringtone and the
wake-up push, and route a `trip_id` push into the call screen. Less
invasive — no migration, no contract change, the desk keeps its instant trip.
Rejected because it builds a *second* ringing pipeline: two notifications,
two wake paths, two call screens, two withdrawal stories, drifting apart
exactly as the two channels already had. ADR-0046's history is a catalogue of
what goes wrong when the ring is assembled from parts that can disagree.

**Send a declined assignment back to the desk.** Safer for corporate work,
and it keeps the desk's deliberate choice of driver and vehicle meaningful.
Put to the owner as the recommendation and declined: they asked for the
walk-in's behaviour, including its rotation.

**A polymorphic owner on `dispatch_offers`.** `morphs()` in place of two
nullable foreign keys. Rejected: it trades two real cascades for a string the
database cannot constrain, on the one table ADR-0024 §5's correctness rests
on.
