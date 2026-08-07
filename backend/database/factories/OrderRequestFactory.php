<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;

/**
 * @extends Factory<OrderRequest>
 */
class OrderRequestFactory extends Factory
{
    protected $model = OrderRequest::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'reference' => OrderRequest::mintReference(),
            'service_type' => OrderRequestServiceType::RIDE,
            'status' => OrderRequestStatus::NEW,
            'contact_name' => fake()->name(),
            'contact_phone' => '+2567'.fake()->numerify('########'),
            'contact_email' => fake()->optional()->safeEmail(),
            'pickup_location' => fake()->streetAddress().', Kampala',
            'dropoff_location' => fake()->streetAddress().', Kampala',
            'scheduled_for' => null,
            'details' => ['passengers' => fake()->numberBetween(1, 4)],
            'notes' => null,
        ];
    }

    public function delivery(): static
    {
        return $this->state(fn () => [
            'service_type' => OrderRequestServiceType::DELIVERY,
            'details' => [
                'item_type' => 'parcel',
                'package_size' => 'medium',
                'recipient_name' => fake()->name(),
                'recipient_phone' => '+2567'.fake()->numerify('########'),
            ],
        ]);
    }

    public function selfDrive(): static
    {
        return $this->state(fn () => [
            'service_type' => OrderRequestServiceType::SELF_DRIVE,
            'pickup_location' => null,
            'dropoff_location' => null,
            'details' => [
                'vehicle_category' => 'suv',
                'start_date' => now()->addDays(3)->toDateString(),
                'end_date' => now()->addDays(6)->toDateString(),
            ],
        ]);
    }
}
