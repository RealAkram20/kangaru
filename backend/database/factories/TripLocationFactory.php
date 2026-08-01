<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Trips\Models\TripLocation;

/**
 * A single GPS ping. Tests that need a *route* should use
 * Tests\Support\GpsFixtures, which lays points along a bearing so the
 * distance between them is a known quantity — random coordinates would
 * produce a distance nobody can assert against.
 *
 * @extends Factory<TripLocation>
 */
class TripLocationFactory extends Factory
{
    protected $model = TripLocation::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            // Central Kampala, so a stray fixture at least lands somewhere
            // the platform actually operates.
            'latitude' => '0.3152000',
            'longitude' => '32.5816000',
            'speed_kph' => '40.00',
            'heading_degrees' => 90,
            'accuracy_metres' => '5.00',
            'recorded_at' => now(),
        ];
    }

    public function forTrip(int $tenantId, int $tripId): static
    {
        return $this->state(fn (array $attributes) => [
            'tenant_id' => $tenantId,
            'trip_id' => $tripId,
        ]);
    }
}
