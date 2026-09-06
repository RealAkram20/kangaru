<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\Notification;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Vehicles\Models\Vehicle;

/**
 * The requester of a corporate booking hears when their car is assigned,
 * when the driver arrives, and when the trip completes — and nothing else.
 * Driven through TripService and the real state machine, so the event
 * fires where the platform fires it.
 */

/**
 * @return array{tenant: Tenant, requester: User, dispatcher: User, booking: Booking, trip: Trip}
 */
function tripProgressFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $requester = User::factory()->create([
        'tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE, 'name' => 'Grace Amongin',
    ]);
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);
    $booking = Booking::factory()->requestedBy($requester)->create([
        'origin' => 'Head Office, Kampala', 'destination' => 'Mbale Branch',
    ]);
    $vehicle = Vehicle::factory()->create(['registration_number' => 'UNW 211R', 'make' => 'Toyota', 'model' => 'Land Cruiser']);
    $driver = Driver::factory()->create(['name' => 'Savion Pacocha']);

    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'booking_id' => $booking->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => $booking->origin,
        'destination' => $booking->destination,
    ], $dispatcher);

    return compact('tenant', 'requester', 'dispatcher', 'booking', 'trip');
}

function moveTrip(User $actor, int $tripId, TripStatus $to, array $extra = []): void
{
    test()->actingAs($actor, 'sanctum')
        ->postJson("/api/v1/trips/{$tripId}/transitions", ['to' => $to->value, ...$extra])
        ->assertOk();
}

it('tells the requester their vehicle and driver were assigned, by first name and plate', function () {
    ['requester' => $requester, 'booking' => $booking, 'trip' => $trip] = tripProgressFixture();

    $notification = Notification::query()->for($requester)->firstOrFail();

    expect($notification->type)->toBe(NotificationType::TRIP_ASSIGNED)
        ->and($notification->subject)->toBe("Booking #{$booking->id}: vehicle assigned")
        ->and($notification->body)->toContain('UNW 211R')
        ->and($notification->body)->toContain('Toyota Land Cruiser')
        ->and($notification->body)->toContain('Savion')
        // First name only — the requester needs to recognise the driver at
        // the kerb, not hold their record.
        ->and($notification->body)->not->toContain('Pacocha')
        ->and($notification->url)->toBe("/trips/{$trip->id}")
        ->and($notification->context['trip_id'])->toBe($trip->id)
        ->and($notification->context['booking_id'])->toBe($booking->id);
});

it('says nothing for the moves in between, and speaks again when the driver arrives', function () {
    ['requester' => $requester, 'dispatcher' => $dispatcher, 'trip' => $trip] = tripProgressFixture();
    Notification::query()->for($requester)->delete();

    moveTrip($dispatcher, $trip->id, TripStatus::ACCEPTED);
    moveTrip($dispatcher, $trip->id, TripStatus::DRIVER_EN_ROUTE);
    expect(Notification::query()->for($requester)->count())->toBe(0);

    moveTrip($dispatcher, $trip->id, TripStatus::DRIVER_ARRIVED);
    $arrived = Notification::query()->for($requester)->firstOrFail();

    expect($arrived->type)->toBe(NotificationType::TRIP_DRIVER_ARRIVED)
        ->and($arrived->body)->toContain('Head Office, Kampala')
        ->and($arrived->body)->toContain('UNW 211R');

    moveTrip($dispatcher, $trip->id, TripStatus::PASSENGER_ONBOARD);
    moveTrip($dispatcher, $trip->id, TripStatus::TRIP_STARTED, ['odometer_start' => 53484]);
    expect(Notification::query()->for($requester)->count())->toBe(1);
});

it('sends the six data points with the completion', function () {
    ['requester' => $requester, 'dispatcher' => $dispatcher, 'trip' => $trip] = tripProgressFixture();
    Notification::query()->for($requester)->delete();

    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED, TripStatus::PASSENGER_ONBOARD] as $to) {
        moveTrip($dispatcher, $trip->id, $to);
    }
    moveTrip($dispatcher, $trip->id, TripStatus::TRIP_STARTED, ['odometer_start' => 53484]);
    moveTrip($dispatcher, $trip->id, TripStatus::TRIP_COMPLETED, ['odometer_end' => 53720]);

    $done = Notification::query()->for($requester)->where('type', NotificationType::TRIP_COMPLETED->value)->firstOrFail();

    expect($done->subject)->toContain('trip completed')
        ->and($done->body)->toContain('236.0 km')
        ->and($done->body)->toContain('53,484 to 53,720')
        ->and($done->context['odometer_start'])->toBe(53484)
        ->and($done->context['odometer_end'])->toBe(53720)
        ->and($done->context['distance_km'])->toBe('236.00')
        ->and($done->context['started_at'])->not->toBeNull()
        ->and($done->context['completed_at'])->not->toBeNull()
        ->and($done->context['duration_minutes'])->not->toBeNull()
        ->and($done->context['registration'])->toBe('UNW 211R');
});

it('tells nobody about a walk-in trip, which has no booking to have requested it', function () {
    ['dispatcher' => $dispatcher] = tripProgressFixture();
    $before = Notification::query()->count();

    $customer = Customer::factory()->create();
    app(TripService::class)->create([
        'customer_id' => $customer->id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'driver_id' => Driver::factory()->create()->id,
        'origin' => 'Kololo',
        'destination' => 'Entebbe',
    ], $dispatcher);

    expect(Notification::query()->count())->toBe($before);
});
