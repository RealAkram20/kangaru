<?php

namespace Modules\Trips\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Events\TripStatusChanged;
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
        $this->assertExactlyOneOwner($attributes);

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

            $trip->load(['vehicle', 'driver']);

            // Creation is the first status; the requester learns a car and
            // a driver now exist for their booking.
            TripStatusChanged::dispatch($trip, null, TripStatus::ASSIGNED);

            return $trip;
        });
    }

    /**
     * ADR-0024 §1: a trip is owned by a client or by a walk-in customer,
     * and never by both or by neither.
     *
     * Asserted here, against the attributes as the caller wrote them,
     * because this service is the only writer of `trips` and this is where
     * the mistake is legible. The `customers` migration set the precedent
     * for keeping an invariant like this readable rather than burying it in
     * a CHECK constraint — and unlike a constraint, this can name which
     * caller got it wrong.
     *
     * Note the asymmetry with `Trip::booted()`, which nulls `tenant_id` on a
     * walk-in trip. That corrects an *ambient* fill by `BelongsToTenant`,
     * which no caller asked for. This catches a caller who passed both, and
     * must run before the model gets a chance to tidy one of them away.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function assertExactlyOneOwner(array $attributes): void
    {
        $hasCustomer = ($attributes['customer_id'] ?? null) !== null;

        // A tenant is usually *not* passed: BelongsToTenant fills it from
        // the request's TenantContext, which is right for every corporate
        // trip. So "no tenant in the array" is not "no owner" — only an
        // explicit tenant alongside an explicit customer is a contradiction.
        $hasExplicitTenant = ($attributes['tenant_id'] ?? null) !== null;

        if ($hasCustomer && $hasExplicitTenant) {
            throw new \LogicException(
                'A trip is owned by a client or by a walk-in customer, never both (ADR-0024 §1). '
                .'Pass customer_id for a walk-in and leave tenant_id to the tenant context.'
            );
        }
    }
}
