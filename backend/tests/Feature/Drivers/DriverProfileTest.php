<?php

use App\Enums\UserRole;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /me/profile` — the facts on the driver app's Profile screen.
 *
 * The mockup drew a photograph, a rating, "(428 trips)", a phone number, a
 * vehicle, a vehicle type and a join date. Only some of those are things this
 * platform holds, and this suite pins the line between them:
 *
 * - **The trip count is completed trips only.** A cancellation is not a trip a
 *   driver did, and counting it would make the figure beside somebody's rating
 *   flatter than their work.
 * - **The rating is deliberately absent from this payload.** `/me/stats`
 *   produces it under ADR-0030's withholding rule, and a second reading of a
 *   figure suppressed below five ratings is a second chance to publish it by
 *   mistake.
 * - **A driver with no vehicle is a normal driver**, not an error.
 */
function profileDriver(array $attributes = []): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id] + $attributes);

    return [$user, $driver];
}

it('serves the facts the profile screen shows', function (): void {
    $vehicle = Vehicle::factory()->create([
        'make' => 'Toyota',
        'model' => 'Wish',
        'registration_number' => 'UBB 123X',
        'category' => 'sedan',
    ]);

    [$user, $driver] = profileDriver([
        'phone' => '+256700123456',
        'vehicle_id' => $vehicle->getKey(),
    ]);

    $response = $this->actingAs($user)->getJson('/api/v1/me/profile')->assertOk();

    $response->assertJsonPath('data.name', $driver->name);
    $response->assertJsonPath('data.phone', '+256700123456');
    $response->assertJsonPath('data.vehicle.registration_number', 'UBB 123X');
    $response->assertJsonPath('data.vehicle.make', 'Toyota');
    // Served rather than title-cased on the handset: Billing prices against
    // `Vehicle::CATEGORIES`, and a second spelling of that list in a mobile
    // bundle is a second place to be wrong when a category is added.
    $response->assertJsonPath('data.vehicle.category_label', 'Sedan');
    $response->assertJsonPath('data.member_since', $driver->created_at?->toDateString());
});

it('counts completed trips only', function (): void {
    [$user, $driver] = profileDriver();

    Trip::factory()->count(3)->create([
        'driver_id' => $driver->getKey(),
        'status' => TripStatus::TRIP_COMPLETED,
    ]);
    // Neither of these is a trip the driver did.
    Trip::factory()->create([
        'driver_id' => $driver->getKey(),
        'status' => TripStatus::CANCELLED,
    ]);
    Trip::factory()->create([
        'driver_id' => $driver->getKey(),
        'status' => TripStatus::NO_SHOW,
    ]);

    $this->actingAs($user)
        ->getJson('/api/v1/me/profile')
        ->assertOk()
        ->assertJsonPath('data.trips_total', 3);
});

it('never counts another driver\'s work', function (): void {
    [$user, $mine] = profileDriver();
    [, $theirs] = profileDriver();

    Trip::factory()->create([
        'driver_id' => $mine->getKey(),
        'status' => TripStatus::TRIP_COMPLETED,
    ]);
    Trip::factory()->count(4)->create([
        'driver_id' => $theirs->getKey(),
        'status' => TripStatus::TRIP_COMPLETED,
    ]);

    $this->actingAs($user)
        ->getJson('/api/v1/me/profile')
        ->assertOk()
        ->assertJsonPath('data.trips_total', 1);
});

it('serves a null vehicle rather than inventing one', function (): void {
    [$user] = profileDriver(['vehicle_id' => null]);

    // Not an edge case: a corporate driver takes whatever the depot hands them
    // that morning, and `driver_presence.vehicle_id` is the per-shift answer.
    $this->actingAs($user)
        ->getJson('/api/v1/me/profile')
        ->assertOk()
        ->assertJsonPath('data.vehicle', null);
});

it('does not carry the rating, which stats already withholds', function (): void {
    [$user] = profileDriver();

    $response = $this->actingAs($user)->getJson('/api/v1/me/profile')->assertOk();

    // Two readings of a number that ADR-0030 §3 suppresses below five ratings
    // is two chances to publish it by mistake. The screen reads it from
    // `/me/stats`, which already applies the rule.
    expect($response->json('data'))->not->toHaveKey('rating')
        ->and($response->json('data'))->not->toHaveKey('rating_count');
});

it('refuses an account that is not a driver', function (): void {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $this->actingAs($user)
        ->getJson('/api/v1/me/profile')
        ->assertForbidden()
        ->assertJsonPath('code', 'NOT_A_DRIVER');
});
