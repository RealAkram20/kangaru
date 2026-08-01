<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Vehicles\Models\Vehicle;

/**
 * PROJECT.md, the anchor client's requirement: "Opening odometer reading is
 * captured at Trip Started; closing reading at Trip Completed.
 * Driver-entered value plus a dashboard photo."
 *
 * The reading on its own is a number a driver typed. The photo is what
 * makes it checkable, which is the entire reason the Bank asked for it.
 */

/**
 * @return array{trip: Trip, driverUser: User, dispatcher: User, tenant: Tenant}
 */
function photoFixture(): array
{
    Storage::fake('local');

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $driverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->forUser($driverUser)->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    $vehicle = Vehicle::factory()->forTenant($tenant)->create();

    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $dispatcher);

    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED, TripStatus::PASSENGER_ONBOARD] as $to) {
        test()->actingAs($dispatcher, 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => $to->value])
            ->assertOk();
    }

    return compact('trip', 'driverUser', 'dispatcher', 'tenant');
}

it('stores the dashboard photo captured with the opening reading', function () {
    ['trip' => $trip, 'driverUser' => $driverUser, 'tenant' => $tenant] = photoFixture();

    $this->actingAs($driverUser, 'sanctum')->post("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_STARTED->value,
        'odometer_start' => 15_000,
        'odometer_photo' => UploadedFile::fake()->image('dashboard.jpg', 1200, 900),
    ])->assertOk();

    $fresh = $trip->fresh();

    expect($fresh->odometer_start)->toBe(15_000);
    expect($fresh->odometer_start_photo_path)->not->toBeNull();

    // ADR-0001: file storage paths are prefixed tenants/{id}/, so a stray
    // path can never address another client's evidence.
    expect($fresh->odometer_start_photo_path)->toStartWith("tenants/{$tenant->id}/trips/{$trip->id}/odometer/start-");
    Storage::assertExists($fresh->odometer_start_photo_path);
});

it('captures the closing photo separately from the opening one', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = photoFixture();

    $this->actingAs($driverUser, 'sanctum')->post("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_STARTED->value,
        'odometer_start' => 15_000,
        'odometer_photo' => UploadedFile::fake()->image('start.jpg'),
    ])->assertOk();

    $this->actingAs($driverUser, 'sanctum')->post("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_COMPLETED->value,
        'odometer_end' => 15_042,
        'odometer_photo' => UploadedFile::fake()->image('end.jpg'),
    ])->assertOk();

    $fresh = $trip->fresh();

    // Two distinct files: the closing photo must never overwrite the
    // opening one, or the pair stops being evidence of two moments.
    expect($fresh->odometer_start_photo_path)->not->toBe($fresh->odometer_end_photo_path);
    expect($fresh->odometer_start_photo_path)->toContain('/start-');
    expect($fresh->odometer_end_photo_path)->toContain('/end-');

    Storage::assertExists($fresh->odometer_start_photo_path);
    Storage::assertExists($fresh->odometer_end_photo_path);
});

it('does not block the trip when no photo is supplied', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = photoFixture();

    // A camera that will not focus in the dark at the start of an upcountry
    // run must not strand a trip. The reading is one of the Bank's six
    // acceptance criteria; the photo supports it.
    $this->actingAs($driverUser, 'sanctum')->postJson("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_STARTED->value,
        'odometer_start' => 15_000,
    ])->assertOk();

    $fresh = $trip->fresh();
    expect($fresh->status)->toBe(TripStatus::TRIP_STARTED);
    expect($fresh->odometer_start_photo_path)->toBeNull();
});

it('rejects a file that is not an image', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = photoFixture();

    $this->actingAs($driverUser, 'sanctum')->post("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_STARTED->value,
        'odometer_start' => 15_000,
        'odometer_photo' => UploadedFile::fake()->create('route.pdf', 200, 'application/pdf'),
    ])->assertStatus(422)->assertJsonValidationErrors('odometer_photo');

    expect($trip->fresh()->status)->toBe(TripStatus::PASSENGER_ONBOARD);
});

it('serves the photo behind auth and tenant scope', function () {
    ['trip' => $trip, 'driverUser' => $driverUser, 'dispatcher' => $dispatcher] = photoFixture();

    $this->actingAs($driverUser, 'sanctum')->post("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_STARTED->value,
        'odometer_start' => 15_000,
        'odometer_photo' => UploadedFile::fake()->image('dashboard.jpg'),
    ])->assertOk();

    // The resource hands out a URL rather than leaving a client to build
    // the path, and null when there is nothing to fetch.
    $response = $this->actingAs($dispatcher, 'sanctum')->getJson("/api/v1/trips/{$trip->id}")->assertOk();
    expect($response->json('data.odometer_start_photo_url'))->toContain("/trips/{$trip->id}/odometer-photo/start");
    expect($response->json('data.odometer_end_photo_url'))->toBeNull();

    $this->actingAs($dispatcher, 'sanctum')
        ->get("/api/v1/trips/{$trip->id}/odometer-photo/start")
        ->assertOk();

    // A photo that was never taken is a 404, not an empty 200.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/odometer-photo/end")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');

});

it('does not serve the photo to an unauthenticated caller', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = photoFixture();

    $this->actingAs($driverUser, 'sanctum')->post("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_STARTED->value,
        'odometer_start' => 15_000,
        'odometer_photo' => UploadedFile::fake()->image('dashboard.jpg'),
    ])->assertOk();

    // `actingAs` persists for the rest of the test, so the guards have to
    // be cleared explicitly. Without this the request below is still
    // authenticated and answers 200 — an assertion that would have passed
    // while proving the opposite of its own name.
    $this->app['auth']->forgetGuards();

    // The photo shows a client's vehicle at a known place and time.
    $this->getJson("/api/v1/trips/{$trip->id}/odometer-photo/start")
        ->assertStatus(401)
        ->assertJsonPath('code', 'UNAUTHENTICATED');
});

it('does not leave an orphaned photo when the transition is rejected', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = photoFixture();

    // Illegal from Passenger Onboard, so the transaction never commits —
    // but the file was already uploaded before it opened.
    $this->actingAs($driverUser, 'sanctum')->post("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::TRIP_COMPLETED->value,
        'odometer_end' => 15_042,
        'odometer_photo' => UploadedFile::fake()->image('orphan.jpg'),
    ])->assertStatus(409)->assertJsonPath('code', 'INVALID_TRIP_TRANSITION');

    // Nothing left behind on disk.
    expect(Storage::allFiles("tenants/{$trip->tenant_id}/trips/{$trip->id}/odometer"))->toBeEmpty();
    expect($trip->fresh()->odometer_end_photo_path)->toBeNull();
});
