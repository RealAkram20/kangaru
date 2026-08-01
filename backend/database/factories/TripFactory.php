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
     * `vehicle_id` and `driver_id` resolve from whatever `tenant_id` ended
     * up as, so `Trip::factory()->forTenant($t)` yields a trip whose
     * vehicle and driver are in that same tenant — never a cross-tenant
     * trip built by accident.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'vehicle_id' => fn (array $attributes) => Vehicle::factory()->create([
                'tenant_id' => $attributes['tenant_id'],
            ])->id,
            'driver_id' => fn (array $attributes) => Driver::factory()->create([
                'tenant_id' => $attributes['tenant_id'],
            ])->id,
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
