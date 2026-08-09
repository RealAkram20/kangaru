<?php

namespace Modules\Dispatch\Services;

use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Notifications\TripOfferedNotification;
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
        // Lapsed-but-open offers are settled first, so "is anything live"
        // is asked of a table that has been brought up to date with the
        // clock. Skipping this is how an order sits forever behind an offer
        // that timed out an hour ago.
        $this->settleLapsedFor($request);

        if ($request->trip_id !== null) {
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
        return DB::transaction(function () use ($offer, $actor) {
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
            DispatchOffer::query()
                ->where('order_request_id', $request->id)
                ->whereKeyNot($locked->id)
                ->live()
                ->update([
                    'status' => DispatchOfferStatus::SUPERSEDED,
                    'responded_at' => now(),
                ]);

            $request->forceFill([
                'trip_id' => $trip->id,
                // The status ADR-0012 defined for "this became real-world
                // work". It now says which work, which is the whole of
                // ADR-0024 §4.
                'status' => OrderRequestStatus::CONVERTED,
            ])->save();

            return $trip;
        });
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
        $lapsed = DispatchOffer::query()->lapsed()->get();

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

        $live = DispatchOffer::query()
            ->where('order_request_id', $request->id)
            ->live()
            ->exists();

        if ($live) {
            return 'offered';
        }

        $round = (int) DispatchOffer::query()->where('order_request_id', $request->id)->max('round');

        // Round zero means nobody has been offered anything yet, which reads
        // as "still looking" — either the search has not started, or it ran
        // and found nobody, and both are honestly "searching" until the
        // rounds are used up. Claiming `unmatched` the instant a first pass
        // came back empty would give up in front of the customer while a
        // driver is two minutes from signing on.
        return $round >= (int) config('dispatch.offer_max_rounds') ? 'unmatched' : 'searching';
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
