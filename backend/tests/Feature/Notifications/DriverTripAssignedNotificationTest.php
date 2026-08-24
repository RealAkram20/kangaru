<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\Notification;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0064: the driver hears when the desk puts a corporate trip on their
 * name. Before this listener a desk-assigned trip reached the driver
 * nowhere a driver looks — the Upcoming list, silently — which an owner
 * watched happen with a delivery they had just dispatched.
 */

/**
 * @param  array<string, mixed>  $driverAttributes
 * @return array{requester: User, driverUser: User|null, trip: Trip}
 */
function assignedTripFixture(array $driverAttributes = [], bool $withBooking = true): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $requester = User::factory()->create([
        'tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    $booking = $withBooking
        ? Booking::factory()->requestedBy($requester)->create([
            'origin' => 'Kampala Road', 'destination' => 'Mukono Health Centre IV, Seeta',
        ])
        : null;

    $driverUser = ($driverAttributes['user_id'] ?? null) === false
        ? null
        : User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $driver = Driver::factory()->create([
        'name' => 'Robert Kizito',
        'user_id' => $driverUser?->id,
    ]);

    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'booking_id' => $booking?->id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'driver_id' => $driver->id,
        'origin' => $booking->origin ?? 'Wandegeya, Kampala',
        'destination' => $booking->destination ?? 'Ntinda Complex',
    ], $dispatcher);

    return compact('requester', 'driverUser', 'trip');
}

it('tells the driver a trip was put on their name, by route and nothing more', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = assignedTripFixture();

    $notification = Notification::query()->for($driverUser)->firstOrFail();

    expect($notification->type)->toBe(NotificationType::DRIVER_TRIP_ASSIGNED)
        ->and($notification->subject)->toBe('New trip assigned to you')
        ->and($notification->body)->toContain('Kampala Road')
        ->and($notification->body)->toContain('Mukono Health Centre IV, Seeta')
        ->and($notification->context['trip_id'])->toBe($trip->id);
});

it('says nothing to a driver with no app account, and still tells the requester', function () {
    ['requester' => $requester] = assignedTripFixture(['user_id' => false]);

    // The desk reaches an account-less driver by phone, as it always has;
    // the requester's own notification is unaffected.
    expect(Notification::query()->count())->toBe(1);
    expect(Notification::query()->for($requester)->count())->toBe(1);
});

it('says nothing about a walk-in trip, whose driver accepted it themselves', function () {
    ['driverUser' => $driverUser] = assignedTripFixture(withBooking: false);

    // Telling a driver about the job they just took is fatigue, not news.
    expect(Notification::query()->for($driverUser)->count())->toBe(0);
});
