<?php

namespace Modules\Dispatch\Services;

use Illuminate\Support\Collection;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Support\GreatCircle;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Services\AvailabilityService;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Vehicles\Models\Vehicle;

/**
 * Which drivers should be offered this walk-in ride, in order
 * (ADR-0024 §3).
 *
 * ## Why not `DispatchRecommender`
 *
 * That one ranks **vehicles** and pairs each with a free driver, because a
 * corporate booking is dispatched by choosing a van: contracts are held
 * against vehicles (ADR-0009), and "contracted to this client" outweighs
 * everything else it scores. A walk-in has no client and no contract, so
 * that weight — the one worth a thousand points — does not exist, and what
 * is left is proximity, which is a fact about the *driver's* position.
 *
 * It also ranks by `live_positions`, which only exist for vehicles already
 * on a trip. Every driver this needs to find is by definition not on one.
 *
 * ## Three hard filters, then a score
 *
 * Same structure as ADR-0020 §3, and for the same reason: anything the
 * accept path would refuse is dropped rather than ranked low, because
 * offering a driver a job that 409s when they take it is worse than offering
 * fewer — and a low-ranked unusable candidate still gets reached on a thin
 * night.
 *
 * The filters are **availability** (ADR-0017 — rosters, approved leave,
 * status, conflicting trips), **presence** (on duty, and heard from recently
 * enough to believe), and **seating**.
 *
 * ## What is deliberately not scored
 *
 * Driver rating and acceptance rate. `Modules/Drivers/README.md` lists both
 * as unbuilt, and inventing a weight for a column that does not exist would
 * be designing a feature nobody has specified. When they arrive they are
 * additional terms here, not a rewrite.
 */
class WalkInRecommender
{
    public function __construct(
        private readonly AvailabilityService $availability,
        private readonly DriverPresenceStore $presence,
    ) {}

    /**
     * @return Collection<int, WalkInCandidate>
     */
    public function forOrderRequest(OrderRequest $request): Collection
    {
        [$from, $to] = $this->availability->windowFor($request->scheduled_for);

        // Availability decides first, presence narrows (ADR-0024 §2). Asked
        // in this order deliberately: availability is the authority on
        // whether a driver may work at all, and a driver on approved leave
        // who left the app on must not be offered anything just because
        // their handset is still reporting.
        $available = $this->availability->availableDrivers($from, $to);

        if ($available->isEmpty()) {
            return collect();
        }

        $availableById = $available->keyBy('id');

        // Narrowed by id rather than fetching everyone on duty: the store
        // pushes this into one indexed query, and dispatch already knows
        // which drivers passed the availability filter.
        $presences = $this->presence
            ->dispatchable($availableById->keys()->all())
            ->keyBy(fn (DriverPresence $presence) => $presence->driverId);

        if ($presences->isEmpty()) {
            return collect();
        }

        $seatsNeeded = $this->seatsNeeded($request);
        $vehicles = $this->vehiclesFor($presences, $seatsNeeded);

        return $presences
            ->map(function (DriverPresence $presence) use ($availableById, $vehicles, $request, $seatsNeeded) {
                /** @var Driver $driver */
                $driver = $availableById->get($presence->driverId);

                return $this->score(
                    $request,
                    $driver,
                    $presence,
                    $presence->vehicleId === null ? null : $vehicles->get($presence->vehicleId),
                    $seatsNeeded,
                );
            })
            ->sortByDesc(fn (WalkInCandidate $candidate) => $candidate->score)
            ->values();
    }

    /**
     * The candidates that could actually be sent an offer, best first.
     *
     * What `DispatchOfferService` builds a wave from — `forOrderRequest()`
     * stays the honest picture of the pool, including the drivers who are on
     * duty without a van.
     *
     * @return Collection<int, WalkInCandidate>
     */
    public function offerableFor(OrderRequest $request): Collection
    {
        return $this->forOrderRequest($request)
            ->filter(fn (WalkInCandidate $candidate) => $candidate->isOfferable())
            ->values();
    }

    private function score(
        OrderRequest $request,
        Driver $driver,
        DriverPresence $presence,
        ?Vehicle $vehicle,
        int $seatsNeeded,
    ): WalkInCandidate {
        $score = 0.0;
        $reasons = [];

        $distanceKm = $this->pickupDistanceKm($request, $presence);

        if ($distanceKm !== null) {
            // The same curve as ADR-0020's, and the same reasoning: steep at
            // the short end because 1 km versus 3 km is minutes a passenger
            // stands on a kerb, while 40 km and 42 km are the same answer.
            //
            // It is the dominant term here, where in `DispatchRecommender`
            // it sits under a 1000-point contract weight. That is the whole
            // difference between dispatching a contracted fleet and hailing:
            // with no contract to honour, nearest *is* the answer.
            $score += 500 / (1 + $distanceKm);
            $reasons[] = sprintf('About %.1f km from the pickup.', $distanceKm);
        } else {
            // Reported, never guessed (ADR-0020 §4). A distance nobody
            // measured is worse than no distance.
            $reasons[] = $request->pickup_latitude === null
                ? 'The pickup has no coordinates, so distance was not used.'
                : 'This driver has not reported a position, so distance was not used.';
        }

        if ($vehicle === null) {
            $reasons[] = $presence->vehicleId === null
                ? 'On duty without a vehicle, so this driver cannot be sent yet.'
                : 'Their vehicle cannot take this booking, so this driver cannot be sent.';
        } else {
            $spare = $vehicle->seating_capacity - $seatsNeeded;

            // A nudge, not a rule — ADR-0020's wording, and its judgement:
            // a fifty-seater collecting one passenger is legal and wasteful,
            // and the spare seats are what a dispatcher would notice.
            $score -= min(max($spare, 0), 20);

            $reasons[] = sprintf('%s, %s.', $vehicle->registration_number, strtolower((string) $vehicle->category));
        }

        return new WalkInCandidate(
            driver: $driver,
            vehicle: $vehicle,
            score: round($score, 2),
            pickupDistanceKm: $distanceKm === null ? null : round($distanceKm, 2),
            reasons: $reasons,
        );
    }

    /**
     * Straight-line kilometres from where the driver is to where the
     * passenger is, or null when either end is unknown.
     *
     * Two ways to be unknown, and both are ordinary rather than
     * exceptional: an order taken over the phone by a dispatcher has no
     * coordinates, and a driver whose handset refuses location permission
     * has no position. Neither is a reason to refuse them work — see
     * `DriverPresence::isDispatchable()` — only a reason not to rank them by
     * distance.
     */
    private function pickupDistanceKm(OrderRequest $request, DriverPresence $presence): ?float
    {
        if ($request->pickup_latitude === null || $request->pickup_longitude === null) {
            return null;
        }

        if (! $presence->hasUsablePosition()) {
            return null;
        }

        return GreatCircle::kilometres(
            (float) $request->pickup_latitude,
            (float) $request->pickup_longitude,
            (float) $presence->latitude,
            (float) $presence->longitude,
        );
    }

    /**
     * How many seats this ride needs.
     *
     * `order_requests` has no `passenger_count` column — unlike `bookings`,
     * which does — so it comes out of the free-form `details` the public
     * form collects. Floored at 1 rather than trusted: a missing or absurd
     * value must not silently filter the entire fleet out of a ranking, and
     * "at least one passenger" is true of every ride ever ordered.
     */
    private function seatsNeeded(OrderRequest $request): int
    {
        $details = $request->details ?? [];
        $stated = $details['passengers'] ?? $details['passenger_count'] ?? null;

        return max(1, (int) $stated);
    }

    /**
     * The vehicles those drivers are on shift with, big enough for the ride.
     *
     * One query for the whole wave rather than one per driver — this runs on
     * every order that arrives, and a lookup per candidate is the N+1
     * AGENTS.md forbids.
     *
     * A vehicle that is too small, retired or in the workshop simply does
     * not come back, so its driver scores with a null vehicle and is not
     * offerable. That is the hard filter stated once: seating is a fact
     * about the van, and ranking a five-seater low for an eight-passenger
     * ride would still eventually offer it.
     *
     * @param  Collection<int, DriverPresence>  $presences
     * @return Collection<int, Vehicle>
     */
    private function vehiclesFor(Collection $presences, int $seatsNeeded): Collection
    {
        $ids = $presences
            ->map(fn (DriverPresence $presence) => $presence->vehicleId)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($ids === []) {
            return collect();
        }

        return Vehicle::query()
            ->whereIn('id', $ids)
            ->where('status', 'active')
            ->where('seating_capacity', '>=', $seatsNeeded)
            ->get()
            ->keyBy('id');
    }
}