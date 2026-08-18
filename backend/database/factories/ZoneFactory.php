<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Fleet\Enums\ZoneKind;
use Modules\Fleet\Models\Zone;

/**
 * @extends Factory<Zone>
 */
class ZoneFactory extends Factory
{
    protected $model = Zone::class;

    /**
     * A box around central Kampala by default — real coordinates, because
     * the bug this whole feature guards against only shows up with small
     * positive latitudes beside large longitudes.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => null,
            'name' => 'Central Kampala',
            'kind' => ZoneKind::PRICING,
            'boundary' => self::box(0.2800, 32.5300, 0.3900, 32.6400),
            'priority' => ZoneKind::PRICING->defaultPriority(),
            'active' => true,
        ];
    }

    /**
     * @return array<int, array{lat: float, lng: float}>
     */
    public static function box(float $south, float $west, float $north, float $east): array
    {
        return [
            ['lat' => $south, 'lng' => $west],
            ['lat' => $south, 'lng' => $east],
            ['lat' => $north, 'lng' => $east],
            ['lat' => $north, 'lng' => $west],
        ];
    }

    public function serviceArea(): static
    {
        return $this->state(fn () => [
            'name' => 'Greater Kampala',
            'kind' => ZoneKind::SERVICE_AREA,
            'priority' => ZoneKind::SERVICE_AREA->defaultPriority(),
            // Wide enough to include Entebbe, which is genuinely served.
            'boundary' => self::box(-0.1000, 32.3000, 0.6000, 32.9000),
        ]);
    }

    public function forClient(int $tenantId): static
    {
        return $this->state(fn () => [
            'tenant_id' => $tenantId,
            'name' => 'Client campus',
            'kind' => ZoneKind::CLIENT,
            'priority' => ZoneKind::CLIENT->defaultPriority(),
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn () => ['active' => false]);
    }
}
