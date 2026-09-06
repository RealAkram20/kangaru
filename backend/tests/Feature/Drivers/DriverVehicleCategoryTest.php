<?php

use App\Enums\UserRole;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * The category of the vehicle a driver is out in, on the driver list.
 *
 * ## Why it is on this list and not looked up from the fleet
 *
 * The office's question is "who is free on a boda this morning", and until
 * this field existed the only way to answer it was to load the whole fleet
 * beside the roster and join the two by hand — a second request per screen to
 * answer half a question. `DriverResource` carries the plate already; the
 * category is the other half of the same sentence.
 *
 * ## What these pin
 *
 * The **key**, not a label. Categories are office-defined and renameable
 * (ADR-0050), so `boda` is what survives a rename and the web app resolves
 * the name through `categoryLabel`. A resource that helpfully sent "Boda
 * boda" would be sending a string that changes when a clerk edits a
 * category, to a filter comparing it against a stored key.
 */
it('names the category of the vehicle a driver is out in', function () {
    $vehicle = Vehicle::factory()->create(['category' => 'boda']);
    $driver = Driver::factory()->create(['vehicle_id' => $vehicle->id]);

    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/drivers')->assertOk()->json('data');

    $row = collect($rows)->firstWhere('id', $driver->id);

    // The stored key. The office may rename the category tomorrow; a filter
    // comparing labels would stop matching the moment it did.
    expect($row['vehicle']['category'])->toBe('boda');
});

it('sends no vehicle at all for a driver the depot allocates to per shift', function () {
    $driver = Driver::factory()->create(['vehicle_id' => null]);

    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/drivers')->assertOk()->json('data');

    $row = collect($rows)->firstWhere('id', $driver->id);

    // Null, not a category. "Which category is this driver in" has no answer
    // before a vehicle is handed over, and inventing one would put them in
    // every filter on the screen that reads this.
    expect($row['vehicle'])->toBeNull();
});
