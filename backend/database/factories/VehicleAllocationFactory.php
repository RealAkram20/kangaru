<?php

namespace Database\Factories;

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Vehicles\Models\Vehicle;

/**
 * Builds an open-ended, non-exclusive allocation — the Bank's shape, and the
 * default ADR-0009 chose.
 *
 * `exclusive` is stated here rather than left to the column default, because
 * a test that means "not exclusive" should say so: the whole decision is
 * that exclusivity is per contract, and a fixture that is silent about it
 * reads as an oversight in exactly the tests where it is the subject.
 *
 * @extends Factory<VehicleAllocation>
 */
class VehicleAllocationFactory extends Factory
{
    protected $model = VehicleAllocation::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            // The vehicle is Shanitah's and belongs to no tenant (ADR-0005),
            // so it is created independently of the tenant above.
            'vehicle_id' => Vehicle::factory(),
            'starts_on' => now()->subMonth()->toDateString(),
            'ends_on' => null,
            'exclusive' => false,
            'notes' => null,
            'created_by_user_id' => fn (array $attributes) => User::factory()->create([
                'tenant_id' => $attributes['tenant_id'],
                'role' => UserRole::CORPORATE_ADMIN,
            ])->id,
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

    /** A contract that runs between two days, both inclusive. */
    public function between(string $startsOn, ?string $endsOn = null): static
    {
        return $this->state(fn (array $attributes) => [
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
        ]);
    }

    /** The paid-for opt-in: this vehicle works for nobody else meanwhile. */
    public function exclusive(): static
    {
        return $this->state(fn (array $attributes) => ['exclusive' => true]);
    }
}
