<?php

namespace Modules\Dispatch\Services;

use App\Models\User;
use App\Support\Observability\Trace;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Notifications\TripOfferedNotification;
use Modules\Notifications\Notifications\TripOfferWithdrawnNotification;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\DriverUnavailableException;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Trips\Services\VehicleUnavailableException;

/**
 * Offers a walk-in ride to drivers, one wave at a time, and turns an accept
 * into a Trip (ADR-0024 §3–§6).
 *
 * The only writer of `dispatch_offers`, for the same reason
 * `OrderRequestService` is the only writer of `order_requests` and
 * `TripStateMachine` is the only writer of `trips.status`: the expiry rule
 * and the accept race both live here, and a status update anywhere else
 * would bypass them.
 *
 * ## The one rule that shapes everything else
 *
 * **Nothing is written to `trips` until a driver accepts**, and the accept
 * goes through `TripService::create` — which calls `TripAssignmentGuard`,
 * the same pessimistic lock every other assignment path takes. There is
 * still exactly one way a vehicle and driver get onto a trip, which is what
 * makes AGENTS.md's race guarantee worth anything: it is only as good as its
 * narrowest path.
 *
 * ## Expiry is a clock, not a job
 *
 * ADR-0024 §5. An offer is expired because `expires_at` has passed, and
 * every read here evaluates that — `DispatchOffer::isLive()`, `scopeLive`,
 * `scopeLapsed`. `dispatch:advance-offers` moves the search along, but it is
 * an accelerator and not the mechanism.
 *
 * This is the lesson of `KangaruNotification::viaConnections()`, which pins
 * the in-app row to the `sync` connection because a queue worker was not
 * running and an approved booking left the approver's own bell unchanged. A
 * dispatch system whose offers only expire when a worker is alive is one
 * that wedges when the worker dies, holding an order out with a driver who
 * went home, with no way to tell.
 */
class DispatchOfferService
{
    public function __construct(
        private readonly WalkInRecommender $recommender,
        /**
         * The corporate side's ranking (ADR-0068).
         *
         * A second recommender rather than one that knows both: they answer
         * different questions from different tables — a walk-in is ranked on
         * where a driver is standing, a booking on what a client contracted
         * for — and the two have never shared a line of scoring. What they
         * share is this service, which is the right place for the seam.
         */
        private readonly DispatchRecommender $bookings,
        private readonly TripService $trips,
        private readonly TripStateMachine $stateMachine,
    ) {}

    /**
     * Starts or continues the search for a driver.
     *
     * Idempotent while an offer is live: called again — by the scheduler, by
     * a retry, by a second web request — it returns the offers already out
     * rather than opening a second front on the same order. Without that,
     * every tick of `dispatch:advance-offers` would offer the same ride to
     * another driver while the first was still deciding.
     *
     * @return Collection<int, DispatchOffer>
     */
    public function dispatch(OrderRequest $request): Collection
    {
        /*
         * Traced (ADR-0054 §4). This is the method behind *"why is the
         * passenger still watching a spinner"*, and the auto-instrumentation
         * cannot answer it: the search is a run of SELECTs against duty,
         * rosters, allocations and vehicles, and on the waterfall it is
         * indistinguishable from the listing that renders alongside it.
         *
         * `offers` is the half that makes the timing readable. A 700 ms
         * search that opened three offers is the platform working; a 700 ms
         * search that opened none is a fleet with nobody on duty, and the
         * two are the same row without it.
         */
        return Trace::span('dispatch.search', 'find a driver', function () use ($request) {
            $offers = $this->search($request);

            Trace::annotate(['offers' => $offers->count()]);

            return $offers;
        }, ['order_request_id' => $request->id]);
    }

    /**
     * The search itself.
     *
     * Split from {@see dispatch()} so that the span above has a body to wrap
     * and this one keeps its shape — every early return below is a *reason*
     * the search stopped, and folding them into a closure would have meant
     * either restructuring them or nesting the whole method one level deeper
     * for a monitoring call.
     *
     * @return Collection<int, DispatchOffer>
     */
    private function search(OrderRequest $request): Collection
    {
        // Lapsed-but-open offers are settled first, so "is anything live"
        // is asked of a table that has been brought up to date with the
        // clock. Skipping this is how an order sits forever behind an offer
        // that timed out an hour ago.
        $this->settleLapsedFor($request);

        if ($request->trip_id !== null) {
            return collect();
        }

        // A self-drive rental is not a journey and has nobody to collect
        // (`OrderRequestServiceType::dispatchesToDriver`). Refused here rather
        // than only at the two call sites, because this method is the single
        // door into `dispatch_offers` and a guard on the door cannot be walked
        // past by a caller added later.
        if (! $request->service_type->dispatchesToDriver()) {
            return collect();
        }

        $live = DispatchOffer::query()
            ->where('order_request_id', $request->id)
            ->live()
            ->get();

        if ($live->isNotEmpty()) {
            return $live;
        }

        $round = (int) DispatchOffer::query()
            ->where('order_request_id', $request->id)
            ->max('round');

        if ($round >= (int) config('dispatch.offer_max_rounds')) {
            // Exhausted. Deliberately not an exception and deliberately not
            // a status change on the order: it is still exactly what it was
            // — an unfulfilled request in the desk's queue, which is where
            // ADR-0024 §4 says it should land. `searchState()` is what tells
            // the customer's screen so.
            return collect();
        }

        return $this->offerWave($request, $round + 1);
    }

    /**
     * A driver takes the job.
     *
     * The whole thing is one transaction because a half-committed accept is
     * the worst outcome available: an offer marked accepted with no trip
     * would leave a passenger waiting on a driver the platform has stopped
     * looking for.
     *
     * @throws OfferNoLongerOpenException the clock ran out, or somebody else took it
     * @throws OfferHasNoVehicleException the driver is on duty without a van
     * @throws VehicleUnavailableException
     * @throws DriverUnavailableException
     */
    public function accept(DispatchOffer $offer, User $actor): Trip
    {
        /*
         * Traced (ADR-0054 §4), and of everything instrumented on this
         * platform this is the one a driver feels directly: the gap between
         * their thumb landing on Accept and the pickup screen appearing,
         * with a passenger watching them.
         *
         * The whole span sits **inside** one `lockForUpdate` transaction, so
         * its duration is also how long every other driver racing for this
         * job is held at the lock. That makes it the number to watch when
         * the fleet grows — a figure the request's own transaction cannot
         * show, because the request contains more than the lock.
         */
        return Trace::span('dispatch.accept', 'driver takes the job', fn () => DB::transaction(function () use ($offer, $actor) {
            // Lock and re-read before deciding, exactly as
            // `DispatchService::assign` does with its booking: the status on
            // the model passed in was read outside this transaction and may
            // already be stale. This is the read that counts.
            /** @var DispatchOffer $locked */
            $locked = DispatchOffer::whereKey($offer->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isLive()) {
                throw new OfferNoLongerOpenException($locked);
            }

            $request = $locked->orderRequest;
            $booking = $locked->booking_id === null
                ? null
                // Locked for the same reason the walk-in's owner is re-read
                // above: two drivers can be holding offers for one booking
                // (a rotation wave overlapping a decline), and the loser must
                // find the job already taken rather than write a second trip
                // over it.
                //
                // **`allTenants()`, and without it this cannot work at all.**
                // `TenantScope` fails closed: with no tenant bound it
                // excludes every row (`whereRaw('1 = 0')`), and the request
                // this runs in belongs to a *driver*, who is in no client.
                // Scoped, the lookup finds nothing, the guard below reads
                // that as "the job is gone", and every corporate accept
                // answers 409 OFFER_NO_LONGER_OPEN. Found by accepting
                // through the driver's own endpoint in a test rather than
                // calling this service directly, where the dispatcher's
                // tenant was still bound and it appeared to work.
                //
                // This is the opt-out `TenantScope`'s own docblock requires,
                // and it comes with the obligation that docblock attaches:
                // the tenant is set manually, from the booking, when the
                // trip is written below.
                : Booking::allTenants()->whereKey($locked->booking_id)->lockForUpdate()->first();

            if ($request !== null && $request->trip_id !== null) {
                // Two drivers raced and this one lost — or the desk
                // fulfilled the order by hand while it was out. Either way
                // the job is gone, and the app says it was taken rather than
                // showing a failure.
                $this->close($locked, DispatchOfferStatus::SUPERSEDED);

                throw new OfferNoLongerOpenException($locked);
            }

            if ($booking !== null && ! $booking->status->canTransitionTo(BookingStatus::ASSIGNED)) {
                // The desk cancelled it, or assigned it by hand to somebody
                // reachable by phone, while it was ringing. Exactly the
                // walk-in's answer above and for the same reason: the driver
                // is told the job is gone, not that they did something wrong.
                $this->close($locked, DispatchOfferStatus::SUPERSEDED);

                throw new OfferNoLongerOpenException($locked);
            }

            if ($request === null && $booking === null) {
                // Neither owner survives. `DispatchOffer::booted()` refuses
                // to write a row in this shape, so reaching it means the job
                // was deleted underneath a live offer.
                $this->close($locked, DispatchOfferStatus::SUPERSEDED);

                throw new OfferNoLongerOpenException($locked);
            }

            if ($locked->vehicle_id === null) {
                // `trips.vehicle_id` is not nullable, and a passenger cannot
                // ride in an intention. This should be unreachable —
                // `WalkInRecommender::offerableFor` filters these out — and
                // is checked anyway, because "unreachable" is a property of
                // today's callers rather than of this method.
                throw new OfferHasNoVehicleException($locked);
            }

            // The same locked path a dispatcher's assignment takes. If
            // another dispatcher committed this driver or van in the last
            // few seconds, this throws and the whole transaction rolls back
            // — offer included, so the driver is told plainly rather than
            // holding an accepted offer for a trip that does not exist.
            $trip = $this->trips->create($booking === null ? [
                'customer_id' => $request->customer_id,
                'vehicle_id' => $locked->vehicle_id,
                'driver_id' => $locked->driver_id,
                'origin' => $request->pickup_location ?? 'Pickup',
                'destination' => $request->dropoff_location ?? 'As directed',
            ] : [
                // The desk's job (ADR-0068). The same attributes
                // `DispatchService::assign` used to write itself, moved here
                // because the trip is now born from the driver's answer
                // rather than from the dispatcher's press — and written in
                // one place either way, so a corporate trip cannot acquire a
                // second shape depending on which door it came through.
                //
                // The reason travels on the offer rather than being read off
                // the booking, and that is what makes it correct across a
                // rotation: it belongs to the pair a *person* chose, so a
                // later wave — filtered to contracted and main-fleet
                // vehicles, and needing no override — carries null, which is
                // the truth about that pair.
                'allocation_override_reason' => $locked->allocation_override_reason,
                'booking_id' => $booking->id,
                // **Explicit, and it has to be.** `BelongsToTenant` fills
                // this from the ambient `TenantContext`, which was right
                // while the desk was the one pressing the button — the
                // dispatcher's request carries the client. This trip is now
                // written inside the *driver's* request, and a driver
                // belongs to no client, so the ambient tenant is null and a
                // corporate trip would be born owned by nobody. Taken from
                // the booking for the same reason `operator_id` is taken
                // from the driver: it is the source that is always right.
                'tenant_id' => $booking->tenant_id,
                'vehicle_id' => $locked->vehicle_id,
                'driver_id' => $locked->driver_id,
                'origin' => $booking->origin,
                'destination' => $booking->destination,
            ], $actor);

            // The driver has already said yes; the trip must not sit in
            // `assigned` waiting for them to say it again.
            //
            // Found by running the thing end to end: accepting an offer left
            // a trip the app then asked the driver to *accept*, and
            // `DirectContactChannel` withholds the passenger's number until
            // `accepted`, so the call button never appeared either. Two
            // separate symptoms of one missing line.
            //
            // Through `TripStateMachine`, not a status write, so the
            // `assigned → accepted` pair lands in `trip_events` — the offer
            // and the acceptance are different moments and the timeline
            // should show both. ADR-0024 §3 said this; only the code did not.
            $trip = $this->stateMachine->transition($trip, TripStatus::ACCEPTED, $actor);

            // And straight on to the road. A walk-in offer is answered from
            // the driver's seat with the passenger already standing at a
            // kerb (ADR-0024 §7 withholds the number until now, so nothing
            // has happened yet that would need them anywhere else); saying
            // yes *is* setting off. Asking for a second press — "On my way",
            // on another screen — was one more tap on the moment a driver's
            // hands are busiest, and until it was pressed the passenger's
            // screen sat on "Captain assigned" while the captain was already
            // moving. The owner's ruling: automatic the moment they accept.
            //
            // Two transitions, not a new edge: `accepted -> driver_en_route`
            // is the graph as it stands, both rows land on the timeline, and
            // a corporate trip assigned by a dispatcher for four o'clock —
            // which comes through `DispatchService::assign`, not here — still
            // stops at `accepted`, because a driver saying yes to Tuesday is
            // not a driver setting off now.
            //
            // **Walk-ins only, and the paragraph above already said why.**
            // "A corporate trip assigned by a dispatcher for four o'clock
            // still stops at `accepted`, because a driver saying yes to
            // Tuesday is not a driver setting off now." That sentence was
            // written when such a trip could not reach this method at all;
            // ADR-0068 brought it here, and the rule it describes did not
            // change with the door. A desk-assigned job waits for the
            // driver's own "On my way".
            if ($booking === null) {
                $trip = $this->stateMachine->transition($trip, TripStatus::DRIVER_EN_ROUTE, $actor);
            }

            $locked->update([
                'status' => DispatchOfferStatus::ACCEPTED,
                'responded_at' => now(),
                'trip_id' => $trip->id,
            ]);

            // Every other driver still holding this job is told it is gone.
            // Only matters when `offer_wave_size` is above one, and it is
            // written for that case rather than against today's default —
            // a wave size that silently leaks stale offers the first time
            // somebody raises it is a trap set for a config change.
            //
            // Read before the update, because after it there is nothing left
            // to find: `->live()` is what identifies them, and the update is
            // what stops them being live. The rows are needed either way to
            // reach each driver's handset.
            $losers = DispatchOffer::query()
                ->when(
                    $booking === null,
                    fn ($q) => $q->where('order_request_id', $request->id),
                    fn ($q) => $q->where('booking_id', $booking->id),
                )
                ->whereKeyNot($locked->id)
                ->live()
                ->with('driver.user')
                ->get();

            DispatchOffer::query()
                ->whereKey($losers->modelKeys())
                ->update([
                    'status' => DispatchOfferStatus::SUPERSEDED,
                    'responded_at' => now(),
                ]);

            // After the write, never before: a handset told to stop and then
            // re-fetching `GET /me/offers` against un-updated rows would be
            // handed the job straight back, and start ringing again.
            $this->withdraw($losers);

            if ($booking === null) {
                $request->forceFill([
                    'trip_id' => $trip->id,
                    // The status ADR-0012 defined for "this became real-world
                    // work". It now says which work, which is the whole of
                    // ADR-0024 §4.
                    'status' => OrderRequestStatus::CONVERTED,
                ])->save();
            } else {
                // The booking reaches `assigned` here rather than when the
                // desk pressed the button (ADR-0068). That press now starts
                // a search; this is the moment a vehicle and a driver are
                // really committed to the client's work, and it is the same
                // moment `trips` gains the row — one transaction, so the
                // board can never show an assigned booking with no trip.
                $booking->status = BookingStatus::ASSIGNED;
                $booking->save();
            }

            return $trip;
        }), ['offer_id' => $offer->id]);
    }

    /**
     * A driver says no.
     *
     * The search moves on immediately rather than waiting for the clock —
     * that is the entire value of a decline over a timeout, and a system
     * that made a passenger wait out the full window after a driver had
     * already said no would be wasting the one signal it was given.
     */
    public function decline(DispatchOffer $offer, ?string $reason = null): void
    {
        DB::transaction(function () use ($offer, $reason) {
            /** @var DispatchOffer $locked */
            $locked = DispatchOffer::whereKey($offer->id)->lockForUpdate()->firstOrFail();

            if (! $locked->status->isOpen()) {
                // Already settled — a decline that raced the expiry sweep,
                // or a double tap. Nothing to do, and not an error: the
                // driver's intent and the outcome agree.
                return;
            }

            $locked->update([
                'status' => DispatchOfferStatus::DECLINED,
                'responded_at' => now(),
                'decline_reason' => $reason,
            ]);
        });

        $request = $offer->orderRequest;

        if ($request !== null) {
            $this->dispatch($request->refresh());
        }

        // The desk's job moves on the same way (ADR-0068). The owner's
        // ruling on 29 August was that a declined assignment rolls to the
        // next driver rather than going back to the board — so a decline
        // here means exactly what it means for a walk-in, and waiting out
        // the clock first would waste the one signal the driver gave.
        // Unscoped for `accept()`'s reason: a decline arrives on the
        // driver's own request, and the booking belongs to a client the
        // driver is not in.
        $booking = $offer->booking_id === null
            ? null
            : Booking::allTenants()->whereKey($offer->booking_id)->first();

        if ($booking !== null) {
            $this->dispatchBooking($booking);
        }
    }

    /**
     * Settles every offer whose clock has run out, platform-wide, and moves
     * each affected order to its next candidate.
     *
     * What `dispatch:advance-offers` calls. Note what it is *not*: the thing
     * that makes an offer expire. That already happened, on the clock
     * (ADR-0024 §5). This writes the fact down and finds the next driver.
     *
     * @return int offers settled
     */
    public function advance(): int
    {
        // Orders nobody could take when they arrived, before anything else.
        //
        // This was missing, and it is the difference between a search that
        // recovers and one that does not. `dispatch()` runs once, when the
        // order is received; if no driver is on duty at that instant it
        // returns empty and **nothing ever revisits the order** — the sweep
        // below only knows about offers, and there are none. A passenger who
        // ordered thirty seconds before a driver signed on watched a spinner
        // until they gave up.
        //
        // Found by watching exactly that happen on a live server.
        //
        // Traced on its own (ADR-0054 §4). The scheduler already opens a
        // `console.command.scheduled` transaction around this whole command,
        // so the command's duration is recorded without any help — what that
        // transaction cannot say is which of its two halves spent the time,
        // and this half runs a query per unfulfilled order in the retry
        // window. At `everyTenSeconds()` a slow half is a sweep that starts
        // overlapping itself, which `withoutOverlapping()` then silently
        // turns into skipped ticks.
        Trace::span('dispatch.retry_unoffered', 'orders nobody could take', fn () => $this->retryUnoffered());

        $lapsed = DispatchOffer::query()->lapsed()->get();

        // Onto the command's own transaction, not a new span: a count is not
        // a duration, and this is the number that says whether a tick did
        // anything at all.
        Trace::annotate(['lapsed' => $lapsed->count()]);

        if ($lapsed->isEmpty()) {
            return 0;
        }

        DispatchOffer::query()
            ->whereIn('id', $lapsed->pluck('id'))
            ->update(['status' => DispatchOfferStatus::EXPIRED]);

        $orderIds = $lapsed->pluck('order_request_id')->filter()->unique();

        foreach (OrderRequest::query()->whereIn('id', $orderIds)->get() as $request) {
            try {
                $this->dispatch($request);
            } catch (\Throwable $e) {
                // One order that cannot be re-offered must not stop the
                // sweep for every other order — this runs unattended, and a
                // throw here strands every request behind it.
                Log::warning('dispatch.advance_failed', [
                    'order_request_id' => $request->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // The desk's jobs, rolled by the same tick (ADR-0068). A separate
        // loop rather than a shared abstraction over the two owners: they
        // differ in the one place that matters — which recommender chooses
        // the next wave — and a `match` on an owner column inside a single
        // loop would hide that behind a variable name.
        $bookingIds = $lapsed->pluck('booking_id')->filter()->unique();

        // `allTenants()` again, and here the caller makes it plainest of
        // all: this runs from `dispatch:advance-offers` on the scheduler,
        // which has no request and no tenant bound to anything.
        foreach (Booking::allTenants()->whereIn('id', $bookingIds)->get() as $booking) {
            try {
                $this->dispatchBooking($booking);
            } catch (\Throwable $e) {
                Log::warning('dispatch.advance_failed', [
                    'booking_id' => $booking->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $lapsed->count();
    }

    /**
     * Offers again for rides that never reached anybody.
     *
     * Bounded two ways, because an unbounded version would re-dispatch every
     * unfulfilled order in the table on every tick:
     *
     * - **By age.** `offer_retry_window_minutes` — a ride somebody asked for
     *   this morning is not one to send a driver to this afternoon. Past the
     *   window it is the desk's to phone about, which is where ADR-0024 §4
     *   puts an exhausted search anyway.
     * - **By state.** Only orders still open, with no trip and no live
     *   offer. A converted order is done; one already out with a driver is
     *   somebody else's turn.
     */
    private function retryUnoffered(): void
    {
        $window = (int) config('dispatch.offer_retry_window_minutes');

        $stale = OrderRequest::query()
            ->whereNull('trip_id')
            ->whereIn('status', [OrderRequestStatus::NEW, OrderRequestStatus::CONTACTED])
            // Rides and deliveries only. `dispatch()` refuses a rental anyway,
            // so this is not the guard — it is here so the sweep does not load
            // every rental in the retry window on every tick to refuse it one
            // by one, ten times a minute.
            ->whereIn('service_type', OrderRequestServiceType::dispatchableToDriver())
            ->where('created_at', '>=', now()->subMinutes($window))
            // Immediate rides only, matching `receive()`: a booking for this
            // evening is not something to offer now.
            ->where(fn ($q) => $q->whereNull('scheduled_for')->orWhere('scheduled_for', '<=', now()))
            // The scope is spelled out rather than called as `$q->live()`:
            // inside `whereDoesntHave` the builder is typed against the base
            // Model, so a model scope is not visible to it.
            ->whereDoesntHave('offers', fn ($q) => $q
                ->where('status', DispatchOfferStatus::OFFERED)
                ->where('expires_at', '>', now()))
            ->get();

        foreach ($stale as $request) {
            try {
                $this->dispatch($request);
            } catch (\Throwable $e) {
                // One order that cannot be offered must not stop the rest —
                // this runs unattended.
                Log::warning('dispatch.retry_failed', [
                    'order_request_id' => $request->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Where this order's search has got to.
     *
     * Derived rather than stored, and that is a deliberate choice against a
     * `dispatch_state` column: every part of the answer is already a fact in
     * another table, and a cached copy of a fact is a copy that goes wrong
     * when a driver accepts at the same moment a sweep runs.
     *
     * The strings are `RidePhase`'s own names in
     * `frontend/src/pages/public/ride.ts`, whose author wrote that the
     * mapping should be "an identity function rather than a translation
     * table somebody has to keep in step".
     */
    public function searchState(OrderRequest $request): string
    {
        if ($request->trip_id !== null) {
            return 'assigned';
        }

        // The desk gave up on this one, so the customer must be told rather
        // than left on a rail with nothing behind it. Checked before the live
        // offer: closing an order is a human decision that outranks whatever
        // the matcher happens to still have out, and an offer left open on a
        // closed order is exactly the case where the two would disagree.
        if ($request->status === OrderRequestStatus::CLOSED) {
            return 'unmatched';
        }

        $live = DispatchOffer::query()
            ->where('order_request_id', $request->id)
            ->live()
            ->exists();

        if ($live) {
            return 'offered';
        }

        $round = (int) DispatchOffer::query()->where('order_request_id', $request->id)->max('round');

        if ($round >= (int) config('dispatch.offer_max_rounds')) {
            return 'unmatched';
        }

        /*
         * The search is over even though the rounds are not used up.
         *
         * Rounds only advance when a wave is actually *created*. When no
         * driver is offerable, `offerWave()` writes no row and `max('round')`
         * stays where it was — so an order that never reached anybody sits at
         * round zero, `0 >= 5` is never true, and the customer's screen says
         * "Finding you a captain" for the rest of time. Seen exactly that
         * way: one order, no offers, no driver free, a full progress rail and
         * a spinner that could not terminate.
         *
         * `retryUnoffered()` is what would revisit this order, and it is
         * bounded by `offer_retry_window_minutes` — past that window nothing
         * in the platform will ever look at this order again, because the
         * lapsed-offer sweep only knows about offers and there are none. So
         * the honest answer past the window is that no captain was found,
         * which is the state ADR-0024 §4 defined and which hands the order to
         * the desk's queue.
         *
         * Round zero inside the window still reads as `searching`, and that
         * is deliberate: a driver may be two minutes from signing on, and
         * giving up in front of the customer while the platform is still
         * trying would be the opposite lie.
         */
        $window = (int) config('dispatch.offer_retry_window_minutes');

        if ($request->created_at !== null && $request->created_at->lt(now()->subMinutes($window))) {
            return 'unmatched';
        }

        return 'searching';
    }

    /**
     * Opens one wave of offers.
     *
     * @return Collection<int, DispatchOffer>
     */
    private function offerWave(OrderRequest $request, int $round): Collection
    {
        $alreadyAsked = DispatchOffer::query()
            ->where('order_request_id', $request->id)
            ->pluck('driver_id')
            ->all();

        $candidates = $this->recommender
            ->offerableFor($request)
            // A driver who has already declined or timed out on this exact
            // ride is not asked again. Without this the wave loop offers the
            // nearest driver the same job five times while they are asleep,
            // and the passenger waits out five full windows for one answer.
            ->reject(fn (WalkInCandidate $candidate) => in_array($candidate->driver->id, $alreadyAsked, true))
            ->take((int) config('dispatch.offer_wave_size'));

        if ($candidates->isEmpty()) {
            return collect();
        }

        $now = now();
        $expiresAt = $now->copy()->addSeconds((int) config('dispatch.offer_ttl_seconds'));

        $offers = $candidates->values()->map(fn (WalkInCandidate $candidate, int $index) => DispatchOffer::create([
            'order_request_id' => $request->id,
            'driver_id' => $candidate->driver->id,
            'vehicle_id' => $candidate->vehicle?->id,
            'status' => DispatchOfferStatus::OFFERED,
            'round' => $round,
            'rank' => $index + 1,
            'score' => $candidate->score,
            'pickup_distance_km' => $candidate->pickupDistanceKm,
            // Stored, not recomputed on read. ADR-0020 §4 requires a ranking
            // an operator can audit, and "why did it pick him" has to be
            // answerable next week, when the fleet has moved.
            'reasons' => $candidate->reasons,
            'offered_at' => $now,
            'expires_at' => $expiresAt,
        ]));

        $offers->each(fn (DispatchOffer $offer) => $this->ring($offer));

        return $offers;
    }

    /**
     * Puts the offer on the driver's phone (ADR-0025).
     *
     * **Never allowed to fail the dispatch.** This runs inside the request
     * that received a public order, and `TRIP_OFFERED` goes out on the `sync`
     * connection like every in-app row — so a throw here would take the offer
     * down with it. A passenger's ride must not fail because a third-party
     * push service timed out.
     *
     * `ExpoPushChannel` already swallows its own transport errors; this
     * catches everything above it — a driver with no linked user account, a
     * notification that cannot be built. ADR-0025 §3 is what makes that safe:
     * push shortens the latency and is not the transport. The offer is at
     * `GET /me/offers` either way, and the app polls it every five seconds
     * while on duty.
     */
    private function ring(DispatchOffer $offer): void
    {
        try {
            $user = $offer->driver?->user;

            // A driver profile with no sign-in account (ADR-0016). They can
            // be assigned work by a dispatcher, but nothing can reach them —
            // which is exactly why `WalkInRecommender` should not have
            // offered to them, and is worth staying quiet about rather than
            // erroring on: the offer is still valid, and the desk can see it.
            if ($user === null) {
                return;
            }

            $user->notify(TripOfferedNotification::for($offer));
        } catch (\Throwable $e) {
            Log::warning('dispatch.offer_notification_failed', [
                'offer_id' => $offer->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Marks this order's lapsed offers expired, without cascading into a
     * new wave.
     *
     * Separate from `advance()` so `dispatch()` can bring one order up to
     * date with the clock without recursing back into itself.
     */
    private function settleLapsedFor(OrderRequest $request): void
    {
        DispatchOffer::query()
            ->where('order_request_id', $request->id)
            ->lapsed()
            ->update(['status' => DispatchOfferStatus::EXPIRED]);
    }

    private function close(DispatchOffer $offer, DispatchOfferStatus $status): void
    {
        $offer->update(['status' => $status, 'responded_at' => now()]);
    }

    /**
     * Stops the phones still ringing for offers that are over (ADR-0046 §4).
     *
     * Public because two callers kill an offer under a driver and both owe
     * them silence: the accept path here, which supersedes the rest of a
     * wave, and `CustomerRideController`, where the passenger cancelled.
     *
     * ## Everything about this is best-effort, on purpose
     *
     * The device stops on its own. `Ringtone` arms a deadline from the offer's
     * own window when it starts, so a handset falls quiet shortly after the
     * offer could no longer be live whether this arrives or not — and Android
     * will not deliver a silent push to an app it has killed at all. This
     * makes the common case immediate; it does not make it correct, because
     * it already was.
     *
     * So it swallows, exactly as `ring()` above does and for the same reason:
     * it runs inside the transaction that accepted a ride, and a passenger's
     * trip must not roll back because a third-party push service timed out.
     *
     * **Called after the status write, never before.** A driver whose handset
     * received this and re-fetched `GET /me/offers` before the row was
     * updated would be handed the offer straight back, and the ringing would
     * resume — the one failure mode this method can create rather than fix.
     *
     * @param  iterable<DispatchOffer>  $offers
     */
    public function withdraw(iterable $offers): void
    {
        foreach ($offers as $offer) {
            try {
                $offer->driver?->user?->notify(TripOfferWithdrawnNotification::for($offer));
            } catch (\Throwable $e) {
                Log::warning('dispatch.offer_withdrawal_failed', [
                    'offer_id' => $offer->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * The offers currently in front of this driver.
     *
     * `->live()` rather than `where('status', 'offered')`, so an offer whose
     * clock ran out while the app was in a dead zone simply is not in the
     * list — rather than being rendered with a countdown that reads a
     * negative number and a button that 409s.
     *
     * @return Collection<int, DispatchOffer>
     */
    public function openFor(Driver $driver): Collection
    {
        return DispatchOffer::query()
            ->where('driver_id', $driver->id)
            ->live()
            // `booking.tenant` alongside the walk-in's own owner: the offer
            // screen names the client a corporate job is for, and without
            // the eager load that is one query per offer on the hottest
            // endpoint the driver app has (it polls every five seconds).
            ->with(['orderRequest', 'booking.tenant', 'vehicle'])
            ->orderBy('expires_at')
            ->get();
    }

    /**
     * Rings the driver the desk chose (ADR-0068).
     *
     * The first round of a desk assignment, and the only round anybody
     * picked by hand: `DispatchService::assign` has already decided that
     * this driver and this vehicle may take this booking — allocation rules,
     * leave, availability and the service type all checked — so this does
     * not rank anything. It puts the desk's choice in front of the driver
     * and starts the clock.
     *
     * Idempotent while an offer is live, exactly as {@see dispatch()} is: a
     * dispatcher pressing Assign twice, or two dispatchers pressing it at
     * once, gets the offer already ringing rather than a second one on the
     * same booking.
     */
    public function offerBookingToChosen(
        Booking $booking,
        int $vehicleId,
        int $driverId,
        ?string $overrideReason = null,
    ): DispatchOffer {
        return Trace::span('dispatch.offer_booking', 'ring the chosen driver', function () use ($booking, $vehicleId, $driverId, $overrideReason) {
            $this->settleLapsedForBooking($booking);

            $live = DispatchOffer::query()
                ->where('booking_id', $booking->id)
                ->live()
                ->first();

            if ($live !== null) {
                return $live;
            }

            $round = 1 + (int) DispatchOffer::query()
                ->where('booking_id', $booking->id)
                ->max('round');

            $now = now();

            $offer = DispatchOffer::create([
                'booking_id' => $booking->id,
                'driver_id' => $driverId,
                'vehicle_id' => $vehicleId,
                'status' => DispatchOfferStatus::OFFERED,
                'round' => $round,
                'rank' => 1,
                // No score, deliberately. ADR-0020 §4 wants a ranking an
                // operator can audit; there was no ranking here, and writing
                // a number would invent one. The reason line says what
                // actually happened instead.
                'score' => null,
                'pickup_distance_km' => null,
                'reasons' => ['Chosen by the dispatcher'],
                // ADR-0009's audit, held here until there is a trip to put
                // it on. The migration explains why it cannot go straight to
                // `trips` any more.
                'allocation_override_reason' => $overrideReason,
                'offered_at' => $now,
                'expires_at' => $now->copy()->addSeconds((int) config('dispatch.offer_ttl_seconds')),
            ]);

            $this->ring($offer);

            return $offer;
        }, ['booking_id' => $booking->id]);
    }

    /**
     * Finds the next driver for a booking whose offer came back (ADR-0068).
     *
     * The rotation half. Where {@see offerBookingToChosen} carries out one
     * person's decision, this makes the platform's — and it is bounded the
     * same three ways a walk-in's search is: a live offer wins, the round
     * cap ends it, and a driver already asked is never asked twice.
     *
     * When it returns empty the booking is simply unassigned again, which is
     * where the desk left it. That is the terminus the owner's ruling
     * implies: roll to the next driver, and when there is no next driver,
     * the job is a human's to place.
     *
     * @return Collection<int, DispatchOffer>
     */
    public function dispatchBooking(Booking $booking): Collection
    {
        return Trace::span('dispatch.search_booking', 'find another driver', function () use ($booking) {
            $this->settleLapsedForBooking($booking);

            // Somebody accepted, or the desk withdrew it. Either way this
            // booking is no longer looking.
            if (! $booking->status->canTransitionTo(BookingStatus::ASSIGNED)) {
                return collect();
            }

            // A self-drive rental never reaches a driver (ADR-0064 §4).
            // Refused here as well as at the door, for the reason `search()`
            // gives: this is a way into `dispatch_offers`, and a guard on
            // one door is not a guard.
            if (! $booking->service_type->dispatchesToDriver()) {
                return collect();
            }

            $live = DispatchOffer::query()
                ->where('booking_id', $booking->id)
                ->live()
                ->get();

            if ($live->isNotEmpty()) {
                return $live;
            }

            $round = (int) DispatchOffer::query()
                ->where('booking_id', $booking->id)
                ->max('round');

            if ($round >= (int) config('dispatch.offer_max_rounds')) {
                return collect();
            }

            return $this->offerWaveForBooking($booking, $round + 1);
        }, ['booking_id' => $booking->id]);
    }

    /**
     * One rotation wave for a booking.
     *
     * `offerableForFleet` rather than `offerableFor`: the scheduler has no
     * actor, and the fleet running the job is on the booking. See
     * `DispatchRecommender::forBookingInFleet` for why the two doors agree.
     *
     * @return Collection<int, DispatchOffer>
     */
    private function offerWaveForBooking(Booking $booking, int $round): Collection
    {
        $alreadyAsked = DispatchOffer::query()
            ->where('booking_id', $booking->id)
            ->pluck('driver_id')
            ->all();

        $candidates = $this->bookings
            ->offerableForFleet($booking, $booking->operator_id)
            ->reject(fn (DispatchSuggestion $s) => in_array($s->driver->id, $alreadyAsked, true))
            ->take((int) config('dispatch.offer_wave_size'));

        if ($candidates->isEmpty()) {
            return collect();
        }

        $now = now();
        $expiresAt = $now->copy()->addSeconds((int) config('dispatch.offer_ttl_seconds'));

        $offers = $candidates->values()->map(fn (DispatchSuggestion $s, int $index) => DispatchOffer::create([
            'booking_id' => $booking->id,
            'driver_id' => $s->driver->id,
            'vehicle_id' => $s->vehicle->id,
            'status' => DispatchOfferStatus::OFFERED,
            'round' => $round,
            'rank' => $index + 1,
            'score' => $s->score,
            'pickup_distance_km' => $s->pickupDistanceKm,
            'reasons' => $s->reasons,
            'offered_at' => $now,
            'expires_at' => $expiresAt,
        ]));

        $offers->each(fn (DispatchOffer $offer) => $this->ring($offer));

        return $offers;
    }

    /**
     * `settleLapsedFor`, for the desk's side of the table.
     *
     * Two methods rather than one taking a column name: a string column name
     * threaded through a query builder is exactly the shape that survives a
     * rename silently, on the table ADR-0024 §5's correctness rests on.
     */
    private function settleLapsedForBooking(Booking $booking): void
    {
        DispatchOffer::query()
            ->where('booking_id', $booking->id)
            ->lapsed()
            ->update(['status' => DispatchOfferStatus::EXPIRED]);
    }

    /**
     * Stops every phone still ringing for this booking.
     *
     * For the desk taking a job back — a cancellation, or a hand-assignment
     * to a driver who has no app and answers the telephone instead. The
     * status write happens here and the withdrawal after it, which is the
     * order `withdraw()`'s docblock explains at length: a handset told to
     * stop, re-fetching `GET /me/offers` against un-updated rows, is handed
     * the job straight back and starts ringing again.
     */
    public function withdrawForBooking(Booking $booking): void
    {
        $live = DispatchOffer::query()
            ->where('booking_id', $booking->id)
            ->live()
            ->with('driver.user')
            ->get();

        if ($live->isEmpty()) {
            return;
        }

        DispatchOffer::query()
            ->whereKey($live->modelKeys())
            ->update([
                'status' => DispatchOfferStatus::SUPERSEDED,
                'responded_at' => now(),
            ]);

        $this->withdraw($live);
    }
}
