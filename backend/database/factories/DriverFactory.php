<?php

namespace Database\Factories;

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
            'user_id' => null,
            'name' => fake()->name(),
            'phone' => '+2567'.fake()->unique()->numerify('########'),
            'license_number' => fake()->unique()->regexify('DL-[A-Z]{2}-[0-9]{4}'),
            'license_expiry' => now()->addYears(2)->toDateString(),
            'status' => 'active',
        ];
    }

    /**
     * Links the driver profile to the authenticated User who may trigger
     * that driver's own trip transitions (TripPolicy::transition).
     *
     * No tenant is copied across since ADR-0005: a driver works for the
     * platform, not for a client.
     */
    public function forUser(User $user): static
    {
        return $this->state(fn (array $attributes) => [
            'user_id' => $user->id,
        ]);
    }
}
