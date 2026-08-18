<?php

namespace Database\Factories;

use App\Models\Customer;
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
     * The trip carries the tenant; its vehicle and driver do not.
     *
     * Both used to be built with `['tenant_id' => $attributes['tenant_id']]`,
     * which ADR-0005 turned into a column that is not there — so the bare
     * `Trip::factory()->create()` threw "Unknown column 'tenant_id'" and
     * only the `forVehicle()/forDriver()` spellings worked. Every existing
     * test happened to use those, so nothing failed and the trap stayed set
     * for the next person.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'vehicle_id' => fn () => Vehicle::factory()->create()->id,
            'driver_id' => fn () => Driver::factory()->create()->id,
            'origin' => 'Kampala',
            'destination' => fake()->randomElement(['Entebbe', 'Jinja', 'Mbarara', 'Gulu']),
            'status' => TripStatus::ASSIGNED,
        ];
    }

    public function forTenant(Tenant $tenant): static
    {
        return $this->state(fn (array $attributes) => ['tenant_id' => $tenant->id]);
    }

    /**
     * A walk-in customer's trip (ADR-0024 §1): owned by a customer, and
     * therefore owned by no tenant.
     *
     * `tenant_id` is nulled here as well as set, because `definition()`
     * supplies a `Tenant::factory()` and leaving it would both create a
     * client company nobody asked for and produce a trip with two owners —
     * the exact state `TripService::assertExactlyOneOwner` refuses. A
     * factory that can build a row the service would reject is a factory
     * that will eventually be used to "prove" the invariant holds.
     */
    public function forCustomer(Customer $customer): static
    {
        return $this->state(fn (array $attributes) => [
            'tenant_id' => null,
            'customer_id' => $customer->id,
        ]);
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
