<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\User;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * Retiring several vehicles in one action.
 *
 * The single delete has one question — may you, and is it yours. A batch has
 * three more, and each is a way to lose a register:
 *
 * - **All or nothing.** A partial batch leaves an administrator to work out
 *   which of the ten went, from a table that has just changed under them.
 * - **A vehicle out on a job is not deletable**, however it was selected.
 *   Bulk is exactly where that gets missed, because nobody reads ten rows as
 *   carefully as one.
 * - **Another fleet's vehicle is not found**, not forbidden. Saying "forbidden"
 *   confirms the id exists, which is the register disclosure ADR-0055 §3
 *   closed on the listing.
 */

/**
 * A fleet owner on Shanitah, which is the operator `VehicleFactory` puts every
 * vehicle on. Built the way the rest of the suite builds them — `Operator` has
 * no factory on purpose (`InvitationTest` records why).
 */
function bulkFleetOwner(): User
{
    return User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::FLEET_OWNER,
    ]);
}

it('deletes every vehicle chosen, and says how many', function () {
    $user = bulkFleetOwner();
    $vehicles = Vehicle::factory()->count(3)->create();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/vehicles/bulk-delete', ['ids' => $vehicles->pluck('id')->all()])
        ->assertOk()
        ->assertJsonPath('message', '3 vehicles deleted.');

    foreach ($vehicles as $vehicle) {
        // Soft-deleted, not gone: `Vehicle` uses SoftDeletes, and a retired
        // van still has to appear on the trips it drove.
        $this->assertSoftDeleted('vehicles', ['id' => $vehicle->id]);
    }
});

it('deletes nothing at all when one of them is out on a job', function () {
    /*
     * The rule the whole endpoint exists to hold. Two vehicles are free and
     * one is mid-trip; the free two must survive untouched, because a batch
     * that half-happens is the outcome an administrator cannot reconcile.
     *
     * Mutation check: let the service delete what it can instead of refusing,
     * and the two surviving-vehicle assertions below fail.
     */
    $user = bulkFleetOwner();

    $free = Vehicle::factory()->count(2)->create();
    $busy = Vehicle::factory()->create(['registration_number' => 'UBK 999Z']);

    Trip::factory()->create([
        'vehicle_id' => $busy->id,
        'status' => TripStatus::occupyingValues()[0],
    ]);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/vehicles/bulk-delete', [
            'ids' => $free->pluck('id')->push($busy->id)->all(),
        ])
        ->assertStatus(422)
        /*
         * Named, not just counted: the admin has to know which to deselect.
         * Keyed by the reason, with the vehicles under it — the envelope's
         * own field-to-messages shape, used as reason-to-vehicles, so a
         * hundred refusals state their reason once rather than a hundred
         * times.
         */
        ->assertJsonPath('errors', [
            'Out on a job. It can be deleted once the trip is finished.' => ['UBK 999Z'],
        ]);

    foreach ($free as $vehicle) {
        $this->assertDatabaseHas('vehicles', ['id' => $vehicle->id, 'deleted_at' => null]);
    }

    $this->assertDatabaseHas('vehicles', ['id' => $busy->id, 'deleted_at' => null]);
});

it('will not delete another fleet\'s vehicle, and does not admit it exists', function () {
    /*
     * The isolation rule, asserted through the router rather than the policy —
     * a guard is only as deployed as its call sites. The refusal must read the
     * same as for an id that was never a vehicle at all, or the endpoint
     * becomes a way to test whether a registration is on a rival's fleet.
     */
    $user = bulkFleetOwner();

    $rival = Vehicle::factory()->create([
        'operator_id' => Operator::create([
            'name' => 'Rival Transporters',
            'slug' => 'rival-bulk-delete-test',
            'status' => 'active',
        ])->id,
    ]);

    $response = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/vehicles/bulk-delete', ['ids' => [$rival->id, 999_999]])
        ->assertStatus(422);

    /*
     * Both refusals give the same reason, so both sit under one heading — and
     * each is named by id rather than by registration. Telling this user a
     * plate they may not read would be the disclosure the refusal exists to
     * prevent, and the unknown id has no plate to tell them either. The two
     * are indistinguishable, which is the point.
     */
    expect($response->json('errors'))->toBe([
        'This vehicle is not on your fleet.' => ['#'.$rival->id, '#999999'],
    ]);

    $this->assertDatabaseHas('vehicles', ['id' => $rival->id, 'deleted_at' => null]);
});

it('refuses a batch from somebody who may not manage vehicles', function () {
    $vehicle = Vehicle::factory()->create();

    // A driver holds no `vehicles.manage`, and the class-level check is what
    // stops them before a single id is read.
    $driver = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::DRIVER,
    ]);

    $this->actingAs($driver, 'sanctum')
        ->postJson('/api/v1/vehicles/bulk-delete', ['ids' => [$vehicle->id]])
        ->assertForbidden();

    $this->assertDatabaseHas('vehicles', ['id' => $vehicle->id, 'deleted_at' => null]);
});

it('refuses an empty or oversized selection', function () {
    $user = bulkFleetOwner();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/vehicles/bulk-delete', ['ids' => []])
        ->assertStatus(422);

    // The ceiling is the size of the mistake this endpoint can make, so it is
    // asserted rather than left as a number in a rules array.
    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/vehicles/bulk-delete', ['ids' => range(1, 101)])
        ->assertStatus(422);
});
