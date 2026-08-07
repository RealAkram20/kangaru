<?php

namespace Modules\Dispatch\Services;

use Illuminate\Support\Collection;
use Modules\Bookings\Models\Booking;
use Modules\Fleet\Services\AllocationLookup;
use Modules\Fleet\Services\AvailabilityService;
use Modules\Vehicles\Models\Vehicle;

/**
 * The platform pool, ordered for one booking (ADR-0009 §1).
 *
 * "Allocated vehicles rank above the rest" is the half of the decision that
 * a dispatcher is supposed to *see*. Until this existed the rule was only
 * enforced — pass over a contracted vehicle and you were asked why, choose
 * an exclusive one and you were refused — so the ranking was discovered by
 * being stopped rather than by looking. That is a rule the product keeps to
 * itself.
 *
 * ## Why blocked vehicles are listed rather than filtered out
 *
 * A vehicle contracted exclusively elsewhere is returned with
 * `dispatchable: false` and a reason, not dropped. ADR-0009 is explicit that
 * exclusivity "needs a clear error rather than an empty vehicle list": a
 * dispatcher who knows the fleet will ask where UAA 123B went, and silence
 * is the worst available answer. The reason says the vehicle is contracted
 * elsewhere and does **not** name the client, for the same reason the 409
 * does not and a cross-tenant read 404s.
 *
 * ## One rule, one place
 *
 * Every verdict here comes from `AllocationLookup`, which is also what
 * `DispatchService` enforces with. Two implementations of "is a reason
 * owed" would drift, and the drift would be silent — a list that says a
 * vehicle is free and an assignment that refuses it. A test asserts the two
 * agree for every vehicle in the pool.
 *
 * This is a ranking input, not a matcher. Automatic dispatch needs distance
 * and distance needs ADR-0003's live positions, which are unbuilt.
 */
class VehicleCandidates
{
    public function __construct(
        private readonly AllocationLookup $allocations,
        private readonly AvailabilityService $availability,
    ) {}

    /**
     * @return Collection<int, array{vehicle: Vehicle, allocated: bool, dispatchable: bool, requires_override_reason: bool, note: string|null}>
     */
    public function forBooking(Booking $booking): Collection
    {
        $on = $booking->scheduled_for ?? now();

        $contracted = $this->allocations->vehiclesFor($booking->tenant_id, $on);

        // ADR-0017. One query for the whole pool rather than one per
        // vehicle: this list is rendered for every booking on the board.
        [$from, $to] = $this->availability->windowFor($booking->scheduled_for);
        $unavailable = $this->availability->unavailableVehicleIds($from, $to)->flip();

        // Only vehicles that could actually take the trip. The dispatch board
        // filtered this client-side, which meant every caller had to know the
        // rule and a mobile client would have had to reimplement it.
        $vehicles = Vehicle::query()->where('status', 'active')->orderBy('registration_number')->get();

        return $vehicles
            ->map(function (Vehicle $vehicle) use ($booking, $contracted, $on, $unavailable) {
                $allocated = $contracted->contains($vehicle->id);
                $blocked = $this->allocations->exclusiveBlockFor($vehicle->id, $booking->tenant_id, $on) !== null;
                $busy = $unavailable->has($vehicle->id);

                return [
                    'vehicle' => $vehicle,
                    'allocated' => $allocated,
                    'dispatchable' => ! $blocked && ! $busy,
                    // Mirrors DispatchService exactly: a reason is owed only
                    // when this client has something contracted that day and
                    // this is not it. Nothing contracted means nothing was
                    // overridden.
                    'requires_override_reason' => ! $blocked && ! $busy && ! $allocated && $contracted->isNotEmpty(),
                    'note' => $this->noteFor($blocked, $busy, $allocated),
                ];
            })
            // Contracted first, then dispatchable, then by registration so the
            // order is stable rather than incidental. `sortBy` is stable in
            // Laravel, so the registration ordering above survives underneath.
            ->sortBy([
                fn (array $a, array $b) => ($b['allocated'] <=> $a['allocated']),
                fn (array $a, array $b) => ($b['dispatchable'] <=> $a['dispatchable']),
            ])
            ->values();
    }

    /**
     * The sentence shown beside a vehicle, or null when there is nothing to
     * say — which is the common case and should not be furnished with
     * reassuring noise.
     *
     * A method rather than an inline `match` so the declared `?string`
     * widens the literal strings: `Collection`'s value type is invariant, so
     * an inferred union of two exact sentences is not the `string|null` the
     * caller promises.
     *
     * Never names the other client, for the reason the 409 does not.
     */
    private function noteFor(bool $blocked, bool $busy, bool $allocated): ?string
    {
        return match (true) {
            $blocked => 'Contracted exclusively to another client for this date.',
            // Deliberately vague about *which* kind of unavailable. A board
            // shared across a depot should not announce that a named driver
            // is off sick, and for a vehicle the operational fact — you
            // cannot have this one now — is the whole of what a dispatcher
            // acts on. The specific kind stays queryable on the block.
            $busy => 'Not available for this time.',
            $allocated => 'Contracted to this client for this date.',
            default => null,
        };
    }
}
