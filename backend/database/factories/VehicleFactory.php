<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Vehicles\Models\Vehicle;

/**
 * @extends Factory<Vehicle>
 */
class VehicleFactory extends Factory
{
    protected $model = Vehicle::class;

    /**
     * `registration_number` is unique per tenant; a globally unique value
     * satisfies that constraint under every tenant arrangement a test can
     * build, so uniqueness is taken globally rather than per tenant.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'registration_number' => fake()->unique()->regexify('U[A-Z]{2} [0-9]{3}[A-Z]'),
            'make' => 'Toyota',
            'model' => fake()->randomElement(['Hiace', 'Corolla', 'Land Cruiser', 'Noah']),
            'year' => fake()->numberBetween(2015, 2026),
            'category' => 'sedan',
            'seating_capacity' => 5,
            'status' => 'active',
        ];
    }

    public function van(): static
    {
        return $this->state(fn (array $attributes) => [
            'category' => 'van',
            'model' => 'Hiace',
            'seating_capacity' => 14,
        ]);
    }
}
