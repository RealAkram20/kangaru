<?php

namespace Database\Factories;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Drivers\Models\Driver;

/**
 * @extends Factory<Driver>
 */
class DriverFactory extends Factory
{
    protected $model = Driver::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'user_id' => null,
            'name' => fake()->name(),
            'phone' => '+2567'.fake()->unique()->numerify('########'),
            'license_number' => fake()->unique()->regexify('DL-[A-Z]{2}-[0-9]{4}'),
            'license_expiry' => now()->addYears(2)->toDateString(),
            'status' => 'active',
        ];
    }

    public function forTenant(Tenant $tenant): static
    {
        return $this->state(fn (array $attributes) => ['tenant_id' => $tenant->id]);
    }

    /**
     * Links the driver profile to the authenticated User who may trigger
     * that driver's own trip transitions (TripPolicy::transition). The
     * tenant is taken from the user deliberately — a driver profile and
     * its login must never straddle two tenants (ADR-0001).
     */
    public function forUser(User $user): static
    {
        return $this->state(fn (array $attributes) => [
            'user_id' => $user->id,
            'tenant_id' => $user->tenant_id,
        ]);
    }
}
