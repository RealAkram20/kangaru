<?php

namespace Database\Factories;

use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Clients\Models\ClientRoute;

/**
 * @extends Factory<ClientRoute>
 */
class ClientRouteFactory extends Factory
{
    protected $model = ClientRoute::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            // @see ClientPlaceFactory for why this is unique.
            'name' => fake()->unique()->city().' ATM Run',
            'is_active' => true,
        ];
    }

    public function forTenant(Tenant $tenant): static
    {
        return $this->state(fn (array $attributes) => ['tenant_id' => $tenant->id]);
    }
}
