<?php

namespace Database\Factories;

use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * Builds a Trip in its initial `Assigned` state, matching what
 * TripService::create() writes. It deliberately does NOT write the opening
 * `trip_events` row and does not walk the lifecycle — status changes belong
 * to TripStateMachine, and a factory that set `status` to a mid-lifecycle
 * value would produce a trip with no timeline, which is exactly the
 * inconsistency AGENTS.md's append-only timeline rule exists to prevent.
 *
 * @extends Factory<Trip>
 */
class TripFactory extends Factory
{
    protected $model = Trip::class;

    /**
     * The vehicle and driver are the platform's, not the tenant's — the
     * fleet stopped belonging to clients when ADR-0005 was enforced
     * (2026_08_02_160000_move_fleet_to_the_platform). These defaults used
     * to thread `tenant_id` into both factories and were latently broken
     * from that migration on: every existing test happened to pass
     * `forVehicle()`/`forDriver()` explicitly, so the first test to lean on
     * the defaults failed on a column that no longer exists.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'vehicle_id' => Vehicle::factory(),
            'driver_id' => Driver::factory(),
            'origin' => 'Kampala',
            'destination' => fake()->randomElement(['Entebbe', 'Jinja', 'Mbarara', 'Gulu']),
            'status' => TripStatus::ASSIGNED,
        ];
    }

    public function forTenant(Tenant $tenant): static
    {
        return $this->state(fn (array $attributes) => ['tenant_id' => $tenant->id]);
    }

    public function forVehicle(Vehicle $vehicle): static
    {
        return $this->state(fn (array $attributes) => ['vehicle_id' => $vehicle->id]);
    }

    public function forDriver(Driver $driver): static
    {
        return $this->state(fn (array $attributes) => ['driver_id' => $driver->id]);
    }
}
