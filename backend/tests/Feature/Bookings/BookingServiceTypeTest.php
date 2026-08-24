<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0064: the internal booking channel carries all three services.
 *
 * The walk-in form has offered ride, delivery and self-drive since ADR-0012;
 * bookings were rides by construction. This file proves the three now share
 * one channel *and* that the two facts that make that safe hold: a booking's
 * details only ever store and emit its own service's keys, and a self-drive
 * booking can never reach a driver — not through the dispatch queue filter
 * and not through the assignment endpoint itself.
 */

/**
 * @return array{tenant: Tenant, admin: User, colleague: User}
 */
function serviceTypeFixture(): array
{
    $tenant = Tenant::factory()->create();

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $colleague = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Joseph Mukasa',
        'phone' => '+256700111222',
    ]);

    return compact('tenant', 'admin', 'colleague');
}

/** @param array<string, mixed> $overrides */
function serviceBooking(User $actor, array $overrides = [])
{
    return test()->actingAs($actor, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_name' => 'ignored — the account name wins',
        'passenger_phone' => '+256700111222',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
        ...$overrides,
    ]);
}

it('creates a delivery booking and emits only the parcel keys it stored', function () {
    ['admin' => $admin, 'colleague' => $colleague] = serviceTypeFixture();

    $response = serviceBooking($admin, [
        'passenger_user_id' => $colleague->id,
        'service_type' => 'delivery',
        'details' => [
            'item_type' => 'documents',
            'package_size' => 'small',
            'payer' => 'sender',
            'payment_method' => 'mobile_money',
            'recipient_name' => 'Amina Okello',
            'recipient_phone' => '+256701222333',
            'confirm_with_pin' => true,
        ],
    ]);

    $response->assertCreated()
        ->assertJsonPath('data.service_type', 'delivery')
        ->assertJsonPath('data.details.item_type', 'documents')
        ->assertJsonPath('data.details.recipient_name', 'Amina Okello')
        ->assertJsonPath('data.details.confirm_with_pin', true);

    $stored = Booking::allTenants()->firstOrFail();
    expect($stored->service_type)->toBe(OrderRequestServiceType::DELIVERY);
    expect($stored->details)->toHaveKey('recipient_phone', '+256701222333');
});

it('refuses a delivery with nobody to ring at the far end', function () {
    ['admin' => $admin, 'colleague' => $colleague] = serviceTypeFixture();

    serviceBooking($admin, [
        'passenger_user_id' => $colleague->id,
        'service_type' => 'delivery',
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['details.recipient_name', 'details.recipient_phone']);
});

it('creates a self-drive booking with a hire period and no route', function () {
    ['admin' => $admin, 'colleague' => $colleague] = serviceTypeFixture();

    $response = test()->actingAs($admin, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $colleague->id,
        'passenger_name' => 'ignored',
        'passenger_phone' => '+256700111222',
        'service_type' => 'self_drive',
        'details' => [
            'start_date' => now()->addDay()->toDateString(),
            'end_date' => now()->addDays(5)->toDateString(),
            'kyc_documents' => 'National ID, driving permit',
        ],
    ]);

    $response->assertCreated()
        ->assertJsonPath('data.service_type', 'self_drive')
        ->assertJsonPath('data.origin', null)
        ->assertJsonPath('data.destination', null)
        ->assertJsonPath('data.details.kyc_documents', 'National ID, driving permit');
});

it('requires the hire period on a self-drive booking', function () {
    ['admin' => $admin, 'colleague' => $colleague] = serviceTypeFixture();

    test()->actingAs($admin, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $colleague->id,
        'passenger_name' => 'ignored',
        'passenger_phone' => '+256700111222',
        'service_type' => 'self_drive',
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['details.start_date', 'details.end_date']);
});

it('refuses a pickup time on a self-drive booking, whose clock is the hire period', function () {
    ['admin' => $admin, 'colleague' => $colleague] = serviceTypeFixture();

    // The second-clock bug the walk-in queue already had: hire dates in
    // details, scheduled_for null, and "null means now" dispatched a driver
    // to a rental. Here the second clock is refused outright.
    test()->actingAs($admin, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $colleague->id,
        'passenger_name' => 'ignored',
        'passenger_phone' => '+256700111222',
        'service_type' => 'self_drive',
        'scheduled_for' => now()->addDays(2)->toIso8601String(),
        'details' => [
            'start_date' => now()->addDay()->toDateString(),
            'end_date' => now()->addDays(5)->toDateString(),
        ],
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['scheduled_for']);
});

it('stores no details on a ride, even when stale delivery keys ride along', function () {
    ['admin' => $admin, 'colleague' => $colleague] = serviceTypeFixture();

    // The toggle case: a payload built for a delivery, submitted as a ride.
    // Validation cannot refuse the keys — they are valid on *some* service —
    // so the single writer narrows them, and the recipient's number never
    // sits unrendered in a ride's row.
    serviceBooking($admin, [
        'passenger_user_id' => $colleague->id,
        'service_type' => 'ride',
        'details' => ['recipient_name' => 'Stale', 'recipient_phone' => '+256700999888'],
    ])->assertCreated()->assertJsonPath('data.details', null);

    expect(Booking::allTenants()->firstOrFail()->details)->toBeNull();
});

it('treats a payload with no service_type as a ride', function () {
    ['admin' => $admin, 'colleague' => $colleague] = serviceTypeFixture();

    serviceBooking($admin, ['passenger_user_id' => $colleague->id])
        ->assertCreated()
        ->assertJsonPath('data.service_type', 'ride');
});

it('keeps self-drive bookings off the dispatch queue and narrows by service', function () {
    ['tenant' => $tenant, 'admin' => $admin] = serviceTypeFixture();

    $ride = Booking::factory()->forTenant($tenant)->create();
    $rental = Booking::factory()->forTenant($tenant)->create([
        'service_type' => OrderRequestServiceType::SELF_DRIVE,
        'origin' => null,
        'destination' => null,
        'details' => ['start_date' => now()->addDay()->toDateString(), 'end_date' => now()->addDays(3)->toDateString()],
    ]);

    $dispatchable = test()->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/bookings?dispatchable=1')
        ->assertOk()
        ->json('data.*.id');

    expect($dispatchable)->toContain($ride->id)->not->toContain($rental->id);

    $rentals = test()->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/bookings?service_type=self_drive')
        ->assertOk()
        ->json('data.*.id');

    expect($rentals)->toContain($rental->id)->not->toContain($ride->id);
});

it('refuses to send a driver to a self-drive booking with 409 BOOKING_NOT_DISPATCHABLE', function () {
    ['tenant' => $tenant] = serviceTypeFixture();

    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    $rental = Booking::factory()->forTenant($tenant)->create([
        'service_type' => OrderRequestServiceType::SELF_DRIVE,
        'status' => BookingStatus::APPROVED,
        'origin' => null,
        'destination' => null,
    ]);

    $vehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create();

    // The queue filter above is a convenience; this is the rule. A
    // dispatcher may post any booking id, and the walk-in flow has already
    // shown what quietly happens without the guard: a driver accepted a
    // five-day rental as "Pickup → As directed".
    test()->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$rental->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'BOOKING_NOT_DISPATCHABLE');

    expect($rental->fresh()->status)->toBe(BookingStatus::APPROVED);
    expect(Trip::where('booking_id', $rental->id)->count())->toBe(0);
});
