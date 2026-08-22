<?php

namespace Modules\Dispatch\Services;

use App\Models\User;
use App\Support\Observability\Trace;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Enums\OrderRequestStatus;
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

            if ($request === null || $request->trip_id !== null) {
                // Two drivers raced and this one lost — or the desk
                // fulfilled the order by hand while it was out. Either way
                // the job is gone, and the app says it was taken rather than
                // showing a failure.
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
            $trip = $this->trips->create([
                'customer_id' => $request->customer_id,
                'vehicle_id' => $locked->vehicle_id,
                'driver_id' => $locked->driver_id,
                'origin' => $request->pickup_location ?? 'Pickup',
                'destination' => $request->dropoff_location ?? 'As directed',
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
            $trip = $this->stateMachine->transition($trip, TripStatus::DRIVER_EN_ROUTE, $actor);

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
                ->where('order_request_id', $request->id)
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

            $request->forceFill([
                'trip_id' => $trip->id,
                // The status ADR-0012 defined for "this became real-world
                // work". It now says which work, which is the whole of
                // ADR-0024 §4.
                'status' => OrderRequestStatus::CONVERTED,
            ])->save();

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
            ->with(['orderRequest', 'vehicle'])
            ->orderBy('expires_at')
            ->get();
    }
}
