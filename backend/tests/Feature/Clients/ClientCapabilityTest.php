<?php

use App\Enums\ClientCapability;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;

/**
 * Per-person capabilities inside a corporate client (App\Enums\ClientCapability).
 *
 * Roles are platform-wide, so a client cannot own one; a client's
 * administrator can own a person's switches. Each switch is a fixed bundle
 * of existing permissions unioned onto the role, so every policy keeps
 * asking `hasPermission` and nothing new is authorised — these tests prove
 * the union, the escalation rule, the fail-closed edges, and the one flag
 * that is not a permission.
 */

/**
 * @return array{tenant: Tenant, admin: User, employee: User}
 */
function capabilityFixture(): array
{
    $tenant = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    return compact('tenant', 'admin', 'employee');
}

it('unions a capability\'s permissions onto the role', function () {
    ['employee' => $employee] = capabilityFixture();

    expect($employee->hasPermission(Permission::BOOKINGS_APPROVE))->toBeFalse();

    $employee->forceFill(['capabilities' => ['approves_bookings']])->save();
    $employee = $employee->fresh();

    expect($employee->hasPermission(Permission::BOOKINGS_APPROVE))->toBeTrue()
        ->and($employee->hasPermission(Permission::BOOKINGS_VIEW_ALL))->toBeTrue()
        ->and($employee->hasPermission(Permission::TRIPS_VIEW_ALL))->toBeTrue()
        // And nothing beyond the bundle.
        ->and($employee->hasPermission(Permission::INVOICES_VIEW))->toBeFalse()
        ->and($employee->hasPermission(Permission::STAFF_MANAGE))->toBeFalse();
});

it('grants nothing for a slug the enum does not know', function () {
    ['employee' => $employee] = capabilityFixture();

    $employee->forceFill(['capabilities' => ['super_admin', 'drivers.view', 'sees_finance']])->save();
    $employee = $employee->fresh();

    expect(array_map(fn ($c) => $c->value, $employee->capabilities()))->toBe(['sees_finance'])
        ->and($employee->hasPermission(Permission::INVOICES_VIEW))->toBeTrue()
        ->and($employee->hasPermission(Permission::DRIVERS_VIEW))->toBeFalse();
});

it('lets an employee with approves_bookings actually approve, end to end', function () {
    ['admin' => $admin, 'employee' => $employee] = capabilityFixture();
    $requester = User::factory()->create(['tenant_id' => $admin->tenant_id, 'role' => UserRole::CORPORATE_EMPLOYEE]);
    $booking = Booking::factory()->requestedBy($requester)->create();

    // Refused before the switch…
    $this->actingAs($employee, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/approval")
        ->assertForbidden();

    // …switched on by their own administrator through the staff endpoint…
    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['capabilities' => ['approves_bookings']])
        ->assertOk()
        ->assertJsonPath('data.capabilities', ['approves_bookings']);

    // …and allowed after it.
    $this->actingAs($employee->fresh(), 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/approval")
        ->assertOk()
        ->assertJsonPath('data.status', BookingStatus::APPROVED->value);
});

it('refuses a capability the granting administrator does not hold themselves', function () {
    ['tenant' => $tenant] = capabilityFixture();
    // A dispatcher may administer nobody; make one who may, but who lacks
    // invoices.view: give a Corporate Employee manages_staff and have them
    // try to hand out sees_finance.
    $clerk = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'capabilities' => ['manages_staff'],
    ]);
    $colleague = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    $this->actingAs($clerk, 'sanctum')
        ->patchJson("/api/v1/users/{$colleague->id}", ['capabilities' => ['sees_finance']])
        ->assertStatus(422)
        ->assertJsonValidationErrors('capabilities');

    // What they do hold, they may grant.
    $this->actingAs($clerk, 'sanctum')
        ->patchJson("/api/v1/users/{$colleague->id}", ['capabilities' => ['manages_staff']])
        ->assertOk();
});

it('refuses capabilities on a platform account', function () {
    $owner = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $staff = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $this->actingAs($owner, 'sanctum')
        ->patchJson("/api/v1/users/{$staff->id}", ['capabilities' => ['sees_finance']])
        ->assertStatus(422)
        ->assertJsonValidationErrors('capabilities');
});

it('rejects an unknown capability slug at the door', function () {
    ['admin' => $admin, 'employee' => $employee] = capabilityFixture();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['capabilities' => ['runs_the_fleet']])
        ->assertStatus(422)
        ->assertJsonValidationErrors('capabilities.0');
});

it('replaces the whole list on update, so a switch turned off stays off', function () {
    ['admin' => $admin, 'employee' => $employee] = capabilityFixture();
    $employee->forceFill(['capabilities' => ['approves_bookings', 'sees_finance']])->save();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['capabilities' => ['sees_finance']])
        ->assertOk()
        ->assertJsonPath('data.capabilities', ['sees_finance']);

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['capabilities' => []])
        ->assertOk()
        ->assertJsonPath('data.capabilities', []);
});

it('lets a corporate admin create a colleague with capabilities set', function () {
    ['admin' => $admin] = capabilityFixture();

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/users', [
            'name' => 'Grace Amongin',
            'email' => 'grace@centenary-bank.test',
            'phone' => '+256700000001',
            'password' => 'a-long-enough-password-1',
            'role' => UserRole::CORPORATE_EMPLOYEE->value,
            'capabilities' => ['sees_finance'],
            'books_without_approval' => true,
        ])
        ->assertCreated()
        ->assertJsonPath('data.capabilities', ['sees_finance'])
        ->assertJsonPath('data.books_without_approval', true);
});

it('approves a booking on behalf of someone marked as booking without approval', function () {
    ['admin' => $admin, 'employee' => $employee] = capabilityFixture();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['books_without_approval' => true])
        ->assertOk()
        ->assertJsonPath('data.books_without_approval', true);

    $this->actingAs($employee->fresh(), 'sanctum')
        ->postJson('/api/v1/bookings', [
            'passenger_user_id' => $employee->id,
            'passenger_name' => 'Grace Nakato',
            'passenger_phone' => '+256700111222',
            'origin' => 'Kampala',
            'destination' => 'Entebbe Airport',
        ])
        ->assertCreated()
        ->assertJsonPath('data.status', BookingStatus::APPROVED->value)
        ->assertJsonPath('data.approved_by_user_id', $employee->id);

    // And a colleague without the flag still waits.
    $other = User::factory()->create(['tenant_id' => $admin->tenant_id, 'role' => UserRole::CORPORATE_EMPLOYEE]);
    $this->actingAs($other, 'sanctum')
        ->postJson('/api/v1/bookings', [
            'passenger_user_id' => $other->id,
            'passenger_name' => 'Grace Nakato',
            'passenger_phone' => '+256700111222',
            'origin' => 'Kampala',
            'destination' => 'Entebbe Airport',
        ])
        ->assertCreated()
        ->assertJsonPath('data.status', BookingStatus::PENDING->value);
});

it('serves the capability catalogue with the staff list, and the switches on every row', function () {
    ['admin' => $admin, 'employee' => $employee] = capabilityFixture();
    $employee->forceFill(['capabilities' => ['sees_finance']])->save();

    $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/users')->assertOk();

    expect(array_column($response->json('meta.capabilities'), 'slug'))
        ->toBe(array_map(fn ($c) => $c->value, ClientCapability::cases()));

    $row = collect($response->json('data'))->firstWhere('id', $employee->id);
    expect($row['capabilities'])->toBe(['sees_finance'])
        ->and($row['books_without_approval'])->toBeFalse();
});

it('records a capability change on the audit trail', function () {
    ['admin' => $admin, 'employee' => $employee] = capabilityFixture();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['capabilities' => ['approves_bookings']])
        ->assertOk();

    $this->assertDatabaseHas('audit_logs', [
        'auditable_type' => 'user',
        'auditable_id' => $employee->id,
        'action' => 'updated',
        'user_id' => $admin->id,
    ]);
});
