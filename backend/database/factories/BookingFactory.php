<?php

namespace Database\Factories;

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;

/**
 * Builds a Pending, immediate booking. Approved/assigned states are reached
 * through BookingService and DispatchService rather than set here, for the
 * same reason TripFactory never sets a mid-lifecycle status: a booking
 * stamped Assigned with no trip is a state the product cannot produce.
 *
 * @extends Factory<Booking>
 */
class BookingFactory extends Factory
{
    protected $model = Booking::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'requested_by_user_id' => fn (array $attributes) => User::factory()->create([
                'tenant_id' => $attributes['tenant_id'],
                'role' => UserRole::CORPORATE_EMPLOYEE,
            ])->id,
            'passenger_name' => fake()->name(),
            'passenger_phone' => '+2567'.fake()->unique()->numerify('########'),
            'passenger_count' => 1,
            'origin' => 'Kampala',
            'destination' => fake()->randomElement(['Entebbe', 'Jinja', 'Mbarara', 'Gulu']),
            'scheduled_for' => null,
            'status' => BookingStatus::PENDING,
        ];
    }

    public function forTenant(Tenant $tenant): static
    {
        return $this->state(fn (array $attributes) => ['tenant_id' => $tenant->id]);
    }

    public function requestedBy(User $user): static
    {
        return $this->state(fn (array $attributes) => [
            'requested_by_user_id' => $user->id,
            'tenant_id' => $user->tenant_id,
        ]);
    }

    public function scheduled(?string $when = null): static
    {
        return $this->state(fn (array $attributes) => [
            'scheduled_for' => $when ?? now()->addDay(),
        ]);
    }
}
