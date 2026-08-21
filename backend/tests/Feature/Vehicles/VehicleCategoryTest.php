<?php

use App\Enums\Permission;
use App\Enums\UserRole;
use App\Models\User;
use Modules\Administration\Models\Role;
use Modules\Billing\Models\InvoiceLine;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Models\VehicleCategory;
use Tests\Support\BillingFixtures;

/**
 * ADR-0050 — the fleet's category vocabulary becomes a table.
 *
 * What this file defends is the set of things that, if they broke, would
 * break **silently** and only show up as money:
 *
 * 1. **The key is not writable after creation.** Renaming it would leave
 *    every issued invoice line naming nothing, with no error anywhere.
 * 2. **A category in use is not deletable.** No foreign key enforces this —
 *    `rate_card_rates.vehicle_category` and `invoice_lines.vehicle_category`
 *    are deliberately plain strings — so the controller's refusal is the
 *    only thing there is.
 * 3. **Retiring stops new use and touches nothing existing.**
 * 4. **A retired category stays editable on the vehicle that carries it**,
 *    or retiring a category makes a slice of the fleet uneditable.
 * 5. **Managing the vocabulary is `vehicles.manage`; reading it is
 *    `vehicles.view`**, because the rate card dialog must render the choices
 *    to Finance.
 */
function categoryAdmin(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

/**
 * Reads the fleet, cannot write it.
 *
 * A custom role rather than a borrowed seeded one, so the claim stays about
 * the permission if somebody later grants the fleet to a new job title.
 */
function categoryReader(): User
{
    Role::create([
        'slug' => 'fleet_reader',
        'name' => 'Fleet Reader',
        'is_system' => false,
        'permissions' => [Permission::VEHICLES_VIEW->value],
    ]);

    return User::factory()->create(['tenant_id' => null, 'role' => 'fleet_reader']);
}

/* ------------------------------------------------------------------ 0 --- */

it('lands the nine existing keys from the migration, not from a seeder', function () {
    // The failure this defends against is a production deploy that runs
    // migrations and not seeders: an empty table means every category the
    // vehicle form offers fails validation, so no vehicle can be created at
    // all. A count, not an existence check — `toContain` would still pass
    // with one row.
    expect(VehicleCategory::query()->count())->toBe(9);

    expect(VehicleCategory::query()->ordered()->pluck('key')->all())
        ->toBe(Vehicle::CATEGORIES);

    // Said the way the driver app already says it. Title-casing the key
    // would have produced "Suv".
    expect(VehicleCategory::query()->where('key', 'suv')->value('name'))->toBe('SUV');
});

/* ------------------------------------------------------------------ 1 --- */

it('never accepts a new key on an edit, so an issued invoice keeps reproducing', function () {
    $category = VehicleCategory::query()->where('key', 'sedan')->sole();

    $this->actingAs(categoryAdmin())
        ->patchJson("/api/v1/vehicle-categories/{$category->id}", [
            'name' => 'Saloon car',
            'key' => 'saloon',
        ])
        ->assertStatus(422);

    // Refused at the door rather than silently ignored: the request asked
    // for something the platform will not do, and answering 200 would tell
    // the office it had been renamed.
    expect($category->fresh()->key)->toBe('sedan');
});

it('renames freely, because the name is what every screen renders', function () {
    $category = VehicleCategory::query()->where('key', 'minibus')->sole();

    $this->actingAs(categoryAdmin())
        ->patchJson("/api/v1/vehicle-categories/{$category->id}", ['name' => 'Minibus (14-seat)'])
        ->assertOk()
        ->assertJsonPath('data.name', 'Minibus (14-seat)')
        ->assertJsonPath('data.key', 'minibus');
});

/* ------------------------------------------------------------------ 2 --- */

it('refuses to delete a category a vehicle carries, and names the count', function () {
    $category = VehicleCategory::query()->where('key', 'van')->sole();
    Vehicle::factory()->count(3)->create(['category' => 'van']);

    $response = $this->actingAs(categoryAdmin())
        ->deleteJson("/api/v1/vehicle-categories/{$category->id}")
        ->assertStatus(409)
        ->assertJsonPath('code', 'VEHICLE_CATEGORY_IN_USE');

    // The count, not just "in use". A fleet manager acts on the number.
    expect($response->json('message'))->toContain('3 vehicle(s)');
    // And is told the action that actually resolves it, because the
    // invoice-line half can never be cleared.
    expect($response->json('message'))->toContain('Retire it');

    expect(VehicleCategory::query()->whereKey($category->id)->exists())->toBeTrue();
});

it('refuses to delete a category a rate card prices, across every client', function () {
    $category = VehicleCategory::query()->where('key', 'bus')->sole();

    // A tenant's rate card, seen from a platform actor. Nothing in the
    // database enforces this — `rate_card_rates.vehicle_category` is a
    // plain string with no foreign key — so the refusal is all there is
    // between a delete and an immutable price naming nothing.
    BillingFixtures::tenantWithRateCard(['vehicle_category' => 'bus']);

    $response = $this->actingAs(categoryAdmin())
        ->deleteJson("/api/v1/vehicle-categories/{$category->id}")
        ->assertStatus(409)
        ->assertJsonPath('code', 'VEHICLE_CATEGORY_IN_USE');

    expect($response->json('message'))->toContain('1 rate card price(s)');
});

it('refuses to delete a category an issued invoice line names, across every client', function () {
    $category = VehicleCategory::query()->where('key', 'bus')->sole();

    // An invoice actually issued through the real path, for a bus, priced
    // by a bus rate. A tenant-scoped count would answer "nothing is using
    // it" to a platform actor and let the row be destroyed while a bank's
    // issued invoice still names the key.
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher, 'driver' => $driver]
        = BillingFixtures::tenantWithRateCard(['vehicle_category' => 'bus']);

    $bus = Vehicle::factory()->create(['category' => 'bus']);
    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $bus, $driver, 15_000, 15_042);

    $this->withHeader('Idempotency-Key', 'idem-category-in-use-0001')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice")
        ->assertStatus(201);

    expect(InvoiceLine::allTenants()->where('vehicle_category', 'bus')->count())->toBeGreaterThan(0);

    $response = $this->actingAs(categoryAdmin())
        ->deleteJson("/api/v1/vehicle-categories/{$category->id}")
        ->assertStatus(409);

    // The invoice-line clause specifically. The rate card that priced the
    // trip is also holding the key, so asserting only the 409 would pass
    // with the invoice-line count dropped entirely.
    expect($response->json('message'))->toContain('invoice line(s)');
});

it('deletes a category nothing has ever used', function () {
    $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'quad_bike', 'name' => 'Quad bike'])
        ->assertStatus(201);

    $category = VehicleCategory::query()->where('key', 'quad_bike')->sole();

    $this->actingAs(categoryAdmin())
        ->deleteJson("/api/v1/vehicle-categories/{$category->id}")
        ->assertStatus(204);

    expect(VehicleCategory::query()->count())->toBe(9);
});

/* ------------------------------------------------------------------ 3 --- */

it('stops new vehicles choosing a retired category, and leaves existing ones running', function () {
    $existing = Vehicle::factory()->create(['category' => 'tricycle']);
    $category = VehicleCategory::query()->where('key', 'tricycle')->sole();

    $this->actingAs(categoryAdmin())
        ->patchJson("/api/v1/vehicle-categories/{$category->id}", ['active' => false])
        ->assertOk()
        ->assertJsonPath('data.active', false);

    $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicles', [
            'registration_number' => 'UBB 900T',
            'make' => 'TVS',
            'model' => 'King',
            'year' => 2021,
            'category' => 'tricycle',
            'seating_capacity' => 3,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('category');

    // Retiring voids nothing. The vehicle is untouched and still readable.
    expect($existing->fresh()->category)->toBe('tricycle');
    expect(Vehicle::query()->where('category', 'tricycle')->count())->toBe(1);
});

/* ------------------------------------------------------------------ 4 --- */

it('still lets a clerk edit a vehicle whose category was retired', function () {
    $vehicle = Vehicle::factory()->create(['category' => 'truck', 'color' => 'Wihte']);
    VehicleCategory::query()->where('key', 'truck')->update(['active' => false]);

    // The form resends `category` unchanged; the clerk is fixing a typo in
    // the colour. Without `alsoAllow` this is a 422 on a field nobody
    // touched, and every truck in the fleet becomes uneditable.
    $this->actingAs(categoryAdmin())
        ->patchJson("/api/v1/vehicles/{$vehicle->id}", [
            'category' => 'truck',
            'color' => 'White',
        ])
        ->assertOk();

    expect($vehicle->fresh()->color)->toBe('White');
});

it('will not let that same edit move a vehicle onto a different retired category', function () {
    $vehicle = Vehicle::factory()->create(['category' => 'truck']);
    VehicleCategory::query()->whereIn('key', ['truck', 'bus'])->update(['active' => false]);

    // `alsoAllow` grandfathers **this vehicle's own** category and nothing
    // else. A widened rule that accepted any retired key would let the
    // office quietly keep using a category it had retired.
    $this->actingAs(categoryAdmin())
        ->patchJson("/api/v1/vehicles/{$vehicle->id}", ['category' => 'bus'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('category');

    expect($vehicle->fresh()->category)->toBe('truck');
});

/* ------------------------------------------------------------------ 5 --- */

it('lets a category be read by anyone who may read the fleet', function () {
    // Finance holds `ratecards.manage` and is not a fleet role; the rate
    // card dialog still has to render the categories it prices.
    $this->actingAs(categoryReader())
        ->getJson('/api/v1/vehicle-categories')
        ->assertOk()
        ->assertJsonCount(9, 'data');
});

it('refuses to create a category to someone who may only read the fleet', function () {
    $this->actingAs(categoryReader())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'quad_bike', 'name' => 'Quad bike'])
        ->assertStatus(403);

    expect(VehicleCategory::query()->count())->toBe(9);
});

/* ------------------------------------------------------------------ 6 --- */

it('refuses a key that is not the shape every consumer assumes', function () {
    $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'Quad Bike', 'name' => 'Quad bike'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('key');

    expect(VehicleCategory::query()->count())->toBe(9);
});

it('refuses a key another category already holds', function () {
    $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'sedan', 'name' => 'Saloon'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('key');

    expect(VehicleCategory::query()->count())->toBe(9);
});

it('appends a new category rather than tying it with an existing position', function () {
    $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'quad_bike', 'name' => 'Quad bike'])
        ->assertStatus(201)
        // Nine rows at positions 0-8, so the tenth is 9. A tie would make
        // the list order depend on the name tiebreak and move rows about.
        ->assertJsonPath('data.position', 9);
});
