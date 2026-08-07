<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Vehicles\Models\Vehicle;

/**
 * @extends Factory<AvailabilityBlock>
 */
class AvailabilityBlockFactory extends Factory
{
    protected $model = AvailabilityBlock::class;

    /**
     * Approved by default, because that is the state a test almost always
     * means when it says "this driver is on leave" — an unapproved request
     * withholds nobody from dispatch (ADR-0017 §6), so a factory defaulting
     * to `requested` would make every availability test silently pass for
     * the wrong reason.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'resource_type' => AvailabilityResource::DRIVER,
            'resource_id' => fn () => Driver::factory()->create()->id,
            'kind' => AvailabilityKind::LEAVE,
            'status' => AvailabilityStatus::APPROVED,
            'starts_at' => now()->startOfHour(),
            'ends_at' => now()->startOfHour()->addDay(),
            'reason' => null,
        ];
    }

    public function forDriver(Driver $driver): static
    {
        return $this->state(fn () => [
            'resource_type' => AvailabilityResource::DRIVER,
            'resource_id' => $driver->id,
        ]);
    }

    public function forVehicle(Vehicle $vehicle): static
    {
        return $this->state(fn () => [
            'resource_type' => AvailabilityResource::VEHICLE,
            'resource_id' => $vehicle->id,
            'kind' => AvailabilityKind::MAINTENANCE,
        ]);
    }

    public function requested(): static
    {
        return $this->state(fn () => ['status' => AvailabilityStatus::REQUESTED]);
    }

    /** Spanning a window, for overlap tests that must not depend on "now". */
    public function between(string $from, string $to): static
    {
        return $this->state(fn () => ['starts_at' => $from, 'ends_at' => $to]);
    }
}
