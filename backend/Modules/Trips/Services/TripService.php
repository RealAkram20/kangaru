<?php

namespace Modules\Trips\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;

class TripService
{
    public function __construct(private readonly TripAssignmentGuard $guard) {}

    /**
     * Writes the Trip directly in Assigned status (no "from" state, so
     * this bypasses TripStateMachine::transition() intentionally) and
     * records the initial trip_events row in the same transaction.
     *
     * Takes a plain attribute array rather than the FormRequest it used to,
     * so Modules\Dispatch can create a trip from a Booking without inventing
     * an HTTP request just to satisfy the signature.
     *
     * @param  array<string, mixed>  $attributes  already validated by the caller
     *
     * @throws VehicleUnavailableException
     * @throws DriverUnavailableException
     */
    public function create(array $attributes, User $actor): Trip
    {
        return DB::transaction(function () use ($attributes, $actor) {
            $this->guard->assertAvailable(
                (int) $attributes['vehicle_id'],
                (int) $attributes['driver_id'],
            );

            $trip = Trip::create([
                ...$attributes,
                'status' => TripStatus::ASSIGNED,
            ]);

            TripEvent::record($trip, null, TripStatus::ASSIGNED, $actor, null);

            return $trip->load(['vehicle', 'driver']);
        });
    }
}
