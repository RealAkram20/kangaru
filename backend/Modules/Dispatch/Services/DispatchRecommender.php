<?php

namespace Modules\Dispatch\Services;

use App\Models\User;
use Illuminate\Support\Collection;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Support\GreatCircle;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Services\AllocationLookup;
use Modules\Fleet\Services\AvailabilityService;
use Modules\Trips\Support\LivePositionStore;
use Modules\Vehicles\Models\Vehicle;

/**
 * Which vehicle and driver should take this booking (ADR-0020).
 *
 * PROJECT.md moved automatic dispatch *into* Phase 1 by owner approval on
 * 2 August 2026 — "the platform is a hailing operator, and hailing cannot be
 * manual". `Modules/Dispatch/README.md` has carried it as deferred item 1
 * ever since, blocked on two inputs that now exist: availability (ADR-0017)
 * and live vehicle positions (ADR-0019).
 *
 * ## It suggests; it does not decide
 *
 * This service returns a ranking. Committing one is `DispatchService::assign`
 * and nothing else, so the pessimistic locks, the allocation rules and the
 * availability refusals all apply exactly as they do to a human dispatcher.
 * A matcher with its own assignment path would be a second way to write a
 * trip, and the AGENTS.md race guarantee is only as good as its narrowest
 * path.
 *
 * ## Hard filters, then a score
 *
 * Anything the assignment endpoint would refuse is dropped rather than
 * ranked low — offering a candidate that 409s is worse than offering fewer.
 * What survives is scored, and every component of the score is reported as a
 * sentence: a ranking a dispatcher cannot audit is one they override on
 * instinct, which is manual dispatch with extra steps.
 */
class DispatchRecommender
{
    /**
     * What a category match is worth, and why it is this number (ADR-0051).
     *
     * The owner's rule is "a matching vehicle outranks everything except a
     * contracted one", and the tiers have to hold arithmetically rather than
     * by intention:
     *
     * - the contract bonus is **1000** (ADR-0009 §1: a commercial agreement
     *   must not be overridden by a distance heuristic);
     * - distance contributes at most **500**, as `500 / (1 + km)` at km = 0;
     * - the spare-seat penalty subtracts at most **20**.
     *
     * So a contracted vehicle scores at least `1000 - 20 = 980`, and for it
     * to beat every non-contracted one this bonus must satisfy
     * `CATEGORY_MATCH + 500 < 980` — anything under 480. At 450 the tiers
     * are strict: contract, then category, then distance.
     *
     * It is not a *total* order over distance, deliberately. A matching van
     * 40 km away scores `450 + 12 = 462` and loses to a sedan at the kerb on
     * `500`. That is the right answer and it is what "strong preference"
     * means: at some distance the vehicle that can actually arrive wins, and
     * the reason line says plainly that it is not what was asked for.
     *
     * Changing this number changes who gets sent. It belongs beside the
     * arithmetic that constrains it, not in config.
     */
    private const CATEGORY_MATCH = 450.0;

    public function __construct(
        private readonly AvailabilityService $availability,
        private readonly AllocationLookup $allocations,
        private readonly LivePositionStore $positions,
    ) {}

    /**
     * @return Collection<int, DispatchSuggestion>
     */
    public function forBooking(Booking $booking, User $actor): Collection
    {
        [$from, $to] = $this->availability->windowFor($booking->scheduled_for);

        // `availableDrivers` answers *who is free*, across the platform — it
        // is a utility shared with the availability checks and is right to be
        // unscoped. Which of them are **this fleet's** is a separate question,
        // and it has to be asked here: this collection is the pool the
        // suggestion is chosen from, and `bestFor` hands the winner straight
        // to `assign()`. Unscoped, automatic dispatch could commit another
        // fleet's driver to this fleet's booking — not merely display them.
        //
        // Narrowed through `forActor` rather than a hand-written
        // `operator_id` comparison, so the three access levels keep one
        // definition (ADR-0055 §6).
        $free = $this->availability->availableDrivers($from, $to);

        $mine = Driver::forActor($actor)->whereKey($free->pluck('id')->all())->pluck('id')->flip();

        $drivers = $free->filter(fn (Driver $driver) => $mine->has($driver->id))->values();

        if ($drivers->isEmpty()) {
            return collect();
        }

        $unavailable = $this->availability->unavailableVehicleIds($from, $to)->flip();
        $on = $booking->scheduled_for ?? now();
        $contracted = $this->allocations->vehiclesFor($booking->tenant_id, $on);

        $vehicles = Vehicle::forActor($actor)
            ->where('status', 'active')
            // A hard filter, not a penalty: a five-seater cannot take eight
            // passengers, and ranking it low would still eventually offer it
            // on a thin morning.
            ->where('seating_capacity', '>=', max(1, $booking->passenger_count))
            ->get()
            ->reject(fn (Vehicle $v) => $unavailable->has($v->id))
            ->reject(fn (Vehicle $v) => $this->allocations->exclusiveBlockFor($v->id, $booking->tenant_id, $on) !== null);

        if ($vehicles->isEmpty()) {
            return collect();
        }

        // One driver per vehicle. Pairing every driver with every vehicle
        // would be a cross product nobody reads — 3,000 × 2,000 rows to
        // choose one from — and the choice of driver barely depends on the
        // choice of vehicle once both are free.
        $rankedDrivers = $drivers->values()->all();
        $driverCount = count($rankedDrivers);

        return $vehicles
            ->values()
            ->map(fn (Vehicle $vehicle, int $index) => $this->score(
                $booking,
                $vehicle,
                $rankedDrivers[$index % $driverCount],
                $contracted->contains($vehicle->id),
            ))
            ->sortByDesc(fn (DispatchSuggestion $s) => $s->score)
            ->values();
    }

    /** The single best pair, or null when nothing can take this booking. */
    public function bestFor(Booking $booking, User $actor): ?DispatchSuggestion
    {
        return $this->forBooking($booking, $actor)->first();
    }

    private function score(Booking $booking, Vehicle $vehicle, Driver $driver, bool $allocated): DispatchSuggestion
    {
        $score = 0.0;
        $reasons = [];

        // Contracts outrank everything (ADR-0009 §1). A client who has paid
        // to have vehicles set aside should get them, and a matcher that
        // quietly preferred a closer non-contracted van would be overriding
        // a commercial agreement on a distance heuristic.
        if ($allocated) {
            $score += 1000;
            $reasons[] = 'Contracted to this client for this date.';
        }

        $distanceKm = $this->pickupDistanceKm($booking, $vehicle);

        if ($distanceKm !== null) {
            // Nearer is better, and the curve is deliberately steep at the
            // short end: the difference between 1 km and 3 km is minutes a
            // passenger waits, while 40 km and 42 km are the same answer.
            $score += 500 / (1 + $distanceKm);
            $reasons[] = sprintf('About %.1f km from the pickup.', $distanceKm);
        } else {
            $reasons[] = $booking->origin_latitude === null
                ? 'Pickup has no coordinates, so distance was not used.'
                : 'This vehicle has not reported a position, so distance was not used.';
        }

        // ADR-0051. The kind of vehicle the client asked for.
        //
        // **A preference, not a filter.** The owner was offered a hard
        // filter and chose this: refusing every other category means a bank
        // whose van is out gets no candidate at all, the booking sits, and
        // nothing says why. Ranking says the same thing and still leaves a
        // dispatcher something to send.
        if ($booking->vehicle_category !== null) {
            if ($vehicle->category === $booking->vehicle_category) {
                $score += self::CATEGORY_MATCH;
                $reasons[] = sprintf('%s, as the client requested.', ucfirst($vehicle->category));
            } else {
                // Said on every mismatch, not only the ones that rank badly.
                // A dispatcher reading a list has to be able to see that the
                // top candidate is not what was asked for — that is the
                // whole difference between this and a silent substitution.
                $reasons[] = sprintf(
                    'Not the %s the client requested — this is a %s.',
                    $booking->vehicle_category,
                    $vehicle->category,
                );
            }
        }

        // A gentle nudge, not a rule: a fifty-seater sent to collect one
        // passenger is legal and wasteful, and the spare seats are what a
        // dispatcher would notice.
        $spare = $vehicle->seating_capacity - max(1, $booking->passenger_count);
        $score -= min($spare, 20);

        if ($spare === 0) {
            $reasons[] = 'Seats exactly the passengers booked.';
        }

        $reasons[] = sprintf('%s is free for this window.', $driver->name);

        return new DispatchSuggestion(
            vehicle: $vehicle,
            driver: $driver,
            score: round($score, 2),
            pickupDistanceKm: $distanceKm === null ? null : round($distanceKm, 2),
            reasons: $reasons,
        );
    }

    /**
     * Straight-line kilometres from where the vehicle is to where the
     * passenger is.
     *
     * Null whenever either end is unknown — a booking taken over the phone
     * has no coordinates, and a vehicle that has not pinged has no position.
     * The caller reports that rather than substituting a guess, because a
     * distance nobody measured is worse than no distance at all.
     *
     * Great-circle, not road distance. Road distance needs Mapbox's
     * Directions API, which is unbuilt and metered; at Kampala's scale the
     * two agree closely enough to rank by, and this is a ranking rather than
     * an ETA.
     */
    private function pickupDistanceKm(Booking $booking, Vehicle $vehicle): ?float
    {
        if ($booking->origin_latitude === null || $booking->origin_longitude === null) {
            return null;
        }

        $position = $this->positions->get($vehicle->id);

        if ($position === null || $position->isStale()) {
            return null;
        }

        // Shared with `WalkInRecommender` since ADR-0024, rather than a
        // second private copy: two rankings that disagree about what
        // "0.4 km away" means is a difference nobody could explain.
        return GreatCircle::kilometres(
            (float) $booking->origin_latitude,
            (float) $booking->origin_longitude,
            $position->latitude,
            $position->longitude,
        );
    }
}
