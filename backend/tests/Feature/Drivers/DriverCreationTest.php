<?php

use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Modules\Administration\Models\Role;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0048 §§7–9 — creating and editing a driver from the console.
 *
 * The backend has had `POST /drivers` since Phase 1 and **no screen has ever
 * called it**, so nothing here was ever exercised by a human. What this file
 * defends is the part ADR-0048 added and the part that was never proved:
 *
 * 1. **One transaction, or neither.** A vehicle registered for a driver whose
 *    creation then failed is a fleet record nobody asked for, belonging to
 *    somebody who does not exist.
 * 2. **`vehicles.manage` is checked separately.** Folding fleet creation into
 *    `drivers.manage` is the side door ADR-0016 §1 refuses at length.
 * 3. **The two ways of naming a vehicle are exclusive**, refused rather than
 *    resolved.
 * 4. **Un-ticking the box clears the link and keeps the vehicle.**
 */
function driverPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'Musa Kirya',
        'phone' => '+256 772 123 456',
        'license_number' => 'UG-DL-40021',
        'license_expiry' => now()->addYears(3)->toDateString(),
    ], $overrides);
}

function inlineVehiclePayload(array $overrides = []): array
{
    return array_merge([
        'registration_number' => 'UAX 123X',
        'make' => 'Toyota',
        'model' => 'Premio',
        'year' => 2014,
        'category' => 'sedan',
        'seating_capacity' => 4,
        'color' => 'Silver',
    ], $overrides);
}

/** Holds the fleet as well as the drivers. */
function fleetManager(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

/**
 * Holds `drivers.manage` and **not** `vehicles.manage`.
 *
 * Built as a custom role rather than borrowed from a seeded one, so the test
 * still means what it says if somebody later grants the fleet to Depot
 * Manager: the claim is about the permission, not about a job title.
 */
function clerkWithoutTheFleet(): User
{
    Role::create([
        'slug' => 'driver_clerk',
        'name' => 'Driver Clerk',
        'audience' => RoleAudience::FLEET,
        'is_system' => false,
        'permissions' => [
            Permission::DRIVERS_VIEW->value,
            Permission::DRIVERS_MANAGE->value,
            // Reads the fleet, cannot write it — which is the whole point.
            Permission::VEHICLES_VIEW->value,
        ],
    ]);

    return User::factory()->create(['tenant_id' => null, 'role' => 'driver_clerk']);
}

/* ------------------------------------------------------------------ 1 --- */

it('creates a driver and their own vehicle in one act', function () {
    $this->actingAs(fleetManager())
        ->postJson('/api/v1/drivers', driverPayload([
            'owns_vehicle' => true,
            'vehicle' => inlineVehiclePayload(),
        ]))
        ->assertStatus(201)
        ->assertJsonPath('data.owns_vehicle', true);

    $driver = Driver::sole();
    $vehicle = Vehicle::sole();

    expect($driver->owns_vehicle)->toBeTrue();
    expect($driver->vehicle_id)->toBe($vehicle->id);

    // An ordinary fleet vehicle (ADR-0048 §8) — nothing marks it as having
    // arrived by a side door, because it did not.
    expect($vehicle->registration_number)->toBe('UAX 123X');
    expect($vehicle->status)->toBe('active');
});

it('refuses a licence number the fleet already holds, before writing anything', function () {
    Driver::factory()->create(['license_number' => 'UG-DL-40021']);

    $this->actingAs(fleetManager())
        ->postJson('/api/v1/drivers', driverPayload([
            'owns_vehicle' => true,
            'vehicle' => inlineVehiclePayload(),
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('license_number');

    expect(Vehicle::count())->toBe(0);
})->note('Validation, not the transaction — see the next test for that.');

it('rolls the vehicle back when the driver write itself fails', function () {
    /**
     * **This is the transaction test, and the previous one is not.**
     *
     * Mutation found that out: removing `DB::transaction` from
     * `DriverService::create()` left every assertion green, because a
     * duplicate licence number is refused by the form request *before* the
     * service runs at all. A test that cannot reach the code it names proves
     * nothing about it.
     *
     * So the failure has to happen **inside** the transaction and **after**
     * the vehicle has been written, which is the ordering the guard exists
     * for. A `creating` hook is the honest way to reach it: it stands in for
     * the real cases — a unique index losing a race with a concurrent insert,
     * a disk filling, a connection dropping — none of which a test can stage
     * on demand.
     *
     * `Auditable` hooks `created`, `updated` and `deleted` but **not**
     * `creating`, so forgetting this listener afterwards takes nothing else
     * with it. It is forgotten in a `finally` because a throwing listener
     * left registered would take down every test after it in this file.
     */
    Event::listen(
        'eloquent.creating: '.Driver::class,
        fn () => throw new RuntimeException('the driver write failed'),
    );

    try {
        $this->actingAs(fleetManager())
            ->postJson('/api/v1/drivers', driverPayload([
                'owns_vehicle' => true,
                'vehicle' => inlineVehiclePayload(),
            ]))
            ->assertStatus(500);
    } finally {
        Event::forget('eloquent.creating: '.Driver::class);
    }

    // The vehicle is written first, so without the transaction it survives as
    // a fleet record belonging to a driver who does not exist.
    expect(Vehicle::count())->toBe(0);
    expect(Driver::count())->toBe(0);
});

/* ------------------------------------------------------------------ 2 --- */

it('refuses to register a vehicle for a clerk who does not hold the fleet', function () {
    $clerk = clerkWithoutTheFleet();

    $this->actingAs($clerk)
        ->postJson('/api/v1/drivers', driverPayload([
            'owns_vehicle' => true,
            'vehicle' => inlineVehiclePayload(),
        ]))
        ->assertStatus(403);

    // Neither half landed. The refusal is not a partial success.
    expect(Vehicle::count())->toBe(0);
    expect(Driver::count())->toBe(0);
});

it('still lets that clerk create a driver against an existing fleet vehicle', function () {
    $clerk = clerkWithoutTheFleet();
    $vehicle = Vehicle::factory()->create();

    // The picker, not the form — which is exactly what the screen offers a
    // clerk who cannot write the fleet.
    $this->actingAs($clerk)
        ->postJson('/api/v1/drivers', driverPayload([
            'vehicle_id' => $vehicle->id,
            'owns_vehicle' => false,
        ]))
        ->assertStatus(201);

    expect(Driver::sole()->vehicle_id)->toBe($vehicle->id);
});

/* ------------------------------------------------------------------ 3 --- */

it('refuses a request that both picks and registers a vehicle', function () {
    $vehicle = Vehicle::factory()->create();

    $this->actingAs(fleetManager())
        ->postJson('/api/v1/drivers', driverPayload([
            'owns_vehicle' => true,
            'vehicle_id' => $vehicle->id,
            'vehicle' => inlineVehiclePayload(),
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('vehicle');

    // Refused, not resolved: guessing is how a driver who already had a
    // vehicle acquires a second one nobody notices.
    expect(Vehicle::count())->toBe(1);
    expect(Driver::count())->toBe(0);
});

it('refuses to register a vehicle for a driver not marked as owning one', function () {
    $this->actingAs(fleetManager())
        ->postJson('/api/v1/drivers', driverPayload([
            'owns_vehicle' => false,
            'vehicle' => inlineVehiclePayload(),
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('owns_vehicle');
});

it('refuses a plate the fleet already holds', function () {
    Vehicle::factory()->create(['registration_number' => 'UAX 123X']);

    $this->actingAs(fleetManager())
        ->postJson('/api/v1/drivers', driverPayload([
            'owns_vehicle' => true,
            'vehicle' => inlineVehiclePayload(['registration_number' => 'UAX 123X']),
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('vehicle.registration_number');
});

/* ------------------------------------------------------------------ 4 --- */

it('clears the link but keeps the vehicle when ownership is unticked', function () {
    $vehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create([
        'vehicle_id' => $vehicle->id,
        'owns_vehicle' => true,
    ]);

    $this->actingAs(fleetManager())
        ->patchJson("/api/v1/drivers/{$driver->id}", ['owns_vehicle' => false])
        ->assertOk()
        ->assertJsonPath('data.owns_vehicle', false)
        ->assertJsonPath('data.vehicle_id', null);

    /**
     * **The vehicle survives** (ADR-0048 §8). A checkbox that destroys a
     * fleet record is the silent destruction ADR-0016 §5 refuses elsewhere.
     *
     * Asserted through a scoped query, **not** `$vehicle->fresh()`. Mutation
     * found that one out: `fresh()` builds its query with
     * `newQueryWithoutScopes()`, so it happily returns a soft-deleted row and
     * the assertion could not fail even when the code destroyed the vehicle
     * on purpose. `Vehicle` uses `SoftDeletes`, so the scope is the only
     * thing that would have noticed.
     */
    expect(Vehicle::query()->whereKey($vehicle->id)->exists())->toBeTrue();
    expect(Vehicle::count())->toBe(1);
    expect($driver->fresh()->vehicle_id)->toBeNull();
});

it('does not touch the vehicle link on a patch that never mentions ownership', function () {
    $vehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create([
        'vehicle_id' => $vehicle->id,
        'owns_vehicle' => true,
    ]);

    $this->actingAs(fleetManager())
        ->patchJson("/api/v1/drivers/{$driver->id}", ['phone' => '+256 700 000 001'])
        ->assertOk();

    // PATCH semantics: a request that says nothing about ownership must not
    // clear a link it was not asked about.
    expect($driver->fresh()->vehicle_id)->toBe($vehicle->id);
    expect($driver->fresh()->owns_vehicle)->toBeTrue();
});

it('registers a vehicle onto an existing driver from the edit form', function () {
    $driver = Driver::factory()->create(['vehicle_id' => null, 'owns_vehicle' => false]);

    $this->actingAs(fleetManager())
        ->patchJson("/api/v1/drivers/{$driver->id}", [
            'owns_vehicle' => true,
            'vehicle' => inlineVehiclePayload(['registration_number' => 'UBH 887Y']),
        ])
        ->assertOk();

    expect($driver->fresh()->owns_vehicle)->toBeTrue();
    expect($driver->fresh()->vehicle_id)->toBe(Vehicle::sole()->id);
});

/* -------------------------------------------------- the honest default --- */

it('defaults owns_vehicle to false rather than guessing from the vehicle', function () {
    $vehicle = Vehicle::factory()->create();

    $this->actingAs(fleetManager())
        ->postJson('/api/v1/drivers', driverPayload(['vehicle_id' => $vehicle->id]))
        ->assertStatus(201)
        // A depot driver holding the keys this week. Deriving ownership from
        // `vehicle_id` would answer "has a vehicle", which nobody asked.
        ->assertJsonPath('data.owns_vehicle', false);
});
