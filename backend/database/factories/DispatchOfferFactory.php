<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * Builds an offer that is live — out with a driver, clock running.
 *
 * `expires_at` is relative to `now()` rather than a fixed instant, because
 * liveness is judged against the wall clock on every read (ADR-0024 §5). A
 * factory with a hardcoded expiry would produce offers that are live or
 * lapsed depending on what time the suite happens to run, which is the
 * fixture bug `DriverPresenceStoreTest` already caught once.
 *
 * @extends Factory<DispatchOffer>
 */
class DispatchOfferFactory extends Factory
{
    protected $model = DispatchOffer::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_request_id' => OrderRequest::factory(),
            'driver_id' => fn () => Driver::factory()->create()->id,
            'vehicle_id' => fn () => Vehicle::factory()->create()->id,
            'status' => DispatchOfferStatus::OFFERED,
            'round' => 1,
            'rank' => 1,
            'score' => 400.0,
            'pickup_distance_km' => 0.4,
            'reasons' => ['About 0.4 km from the pickup.'],
            'offered_at' => now(),
            'expires_at' => now()->addSeconds((int) config('dispatch.offer_ttl_seconds')),
        ];
    }

    /**
     * An offer whose clock has run out but which nothing has settled yet —
     * the exact state `dispatch:advance-offers` exists to find, and the one
     * a driver's late accept has to be refused from.
     */
    public function lapsed(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => DispatchOfferStatus::OFFERED,
            'offered_at' => now()->subMinutes(5),
            'expires_at' => now()->subMinutes(4),
        ]);
    }

    /** A driver on duty with no vehicle — rankable, not offerable. */
    public function withoutVehicle(): static
    {
        return $this->state(fn (array $attributes) => ['vehicle_id' => null]);
    }
}
