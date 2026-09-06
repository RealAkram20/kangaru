<?php

namespace Database\Factories;

use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Clients\Models\ClientPlace;

/**
 * @extends Factory<ClientPlace>
 */
class ClientPlaceFactory extends Factory
{
    protected $model = ClientPlace::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            // Unique, because `client_places` has a unique key on
            // (tenant_id, name, deleted_at) and a factory that collides on
            // the second call fails a test for a reason that has nothing to
            // do with what the test was about.
            'name' => fake()->unique()->streetName().' ATM',
            'address' => fake()->streetAddress().', Kampala',
            // Around Kampala rather than fake()->latitude(), which ranges
            // the whole globe: a fixture in the Pacific makes a distance
            // assertion meaningless and a map screenshot useless.
            'latitude' => fake()->randomFloat(7, 0.25, 0.40),
            'longitude' => fake()->randomFloat(7, 32.50, 32.65),
            'is_active' => true,
        ];
    }

    public function forTenant(Tenant $tenant): static
    {
        return $this->state(fn (array $attributes) => ['tenant_id' => $tenant->id]);
    }

    public function at(float $latitude, float $longitude): static
    {
        return $this->state(fn (array $attributes) => [
            'latitude' => $latitude,
            'longitude' => $longitude,
        ]);
    }
}
