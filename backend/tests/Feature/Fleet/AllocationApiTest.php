<?php

use App\Enums\Permission;
use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Modules\Administration\Models\Role;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Vehicles\Models\Vehicle;

use function Pest\Laravel\actingAs;

/**
 * `Modules/Fleet`'s first API (ADR-0009), README item 4.
 *
 * The cross-tenant half of this file is not optional decoration: AGENTS.md
 * makes the isolation suite mandatory and non-skippable, and since ADR-0006
 * it has **two** halves — that a client sees only their own, and the mirror,
 * that a platform user with no permission on a surface sees nothing of it
 * either. Without the second, belonging to no tenant quietly becomes a
 * permission of its own.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);

    $this->bank = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $this->ngo = Tenant::factory()->create(['name' => 'Acme NGO']);
    $this->vehicle = Vehicle::factory()->create();

    $this->superAdmin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $this->dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
    $this->bankAdmin = User::factory()->create(['tenant_id' => $this->bank->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $this->ngoAdmin = User::factory()->create(['tenant_id' => $this->ngo->id, 'role' => UserRole::CORPORATE_ADMIN]);
});

describe('agreeing a contract', function () {
    it('lets a Super Admin agree an allocation for any client', function () {
        actingAs($this->superAdmin)
            ->postJson('/api/v1/allocations', [
                'tenant_id' => $this->bank->id,
                'vehicle_id' => $this->vehicle->id,
                'starts_on' => '2026-09-01',
                'ends_on' => null,
                'exclusive' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('data.exclusive', true)
            ->assertJsonPath('data.client.name', 'Centenary Bank')
            ->assertJsonPath('data.ends_on', null);

        expect(VehicleAllocation::allTenants()->count())->toBe(1);
    });

    it('answers 409 when the overlap rule refuses', function () {
        VehicleAllocation::factory()
            ->forTenant($this->ngo)->forVehicle($this->vehicle)
            ->between('2026-09-01', '2026-09-30')->exclusive()->create();

        actingAs($this->superAdmin)
            ->postJson('/api/v1/allocations', [
                'tenant_id' => $this->bank->id,
                'vehicle_id' => $this->vehicle->id,
                'starts_on' => '2026-09-15',
                'ends_on' => '2026-10-15',
            ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ALLOCATION_CONFLICT');
    });

    it('refuses a Dispatcher, who may read allocations but not agree them', function () {
        actingAs($this->dispatcher)
            ->postJson('/api/v1/allocations', [
                'tenant_id' => $this->bank->id,
                'vehicle_id' => $this->vehicle->id,
                'starts_on' => '2026-09-01',
            ])
            ->assertForbidden();

        expect(VehicleAllocation::allTenants()->count())->toBe(0);
    });

    it('rejects an end date before the start', function () {
        actingAs($this->superAdmin)
            ->postJson('/api/v1/allocations', [
                'tenant_id' => $this->bank->id,
                'vehicle_id' => $this->vehicle->id,
                'starts_on' => '2026-09-10',
                'ends_on' => '2026-09-01',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('ends_on');
    });
});

describe('cross-tenant isolation — the client half', function () {
    it("shows a client only their own client's contracts", function () {
        VehicleAllocation::factory()->forTenant($this->bank)->forVehicle($this->vehicle)->create();
        VehicleAllocation::factory()->forTenant($this->ngo)->forVehicle(Vehicle::factory()->create())->create();

        $response = actingAs($this->bankAdmin)->getJson('/api/v1/allocations')->assertOk();

        expect($response->json('data'))->toHaveCount(1);
        expect($response->json('data.0.tenant_id'))->toBe($this->bank->id);
    });

    it("404s another client's allocation rather than 403", function () {
        $theirs = VehicleAllocation::factory()
            ->forTenant($this->ngo)->forVehicle($this->vehicle)->create();

        // AGENTS.md: cross-tenant resource access returns 404, never 403 —
        // a 403 confirms the row exists.
        actingAs($this->bankAdmin)
            ->getJson("/api/v1/allocations/{$theirs->id}")
            ->assertNotFound();
    });

    it('offers a client no client picker, because they never had a choice', function () {
        actingAs($this->bankAdmin)
            ->getJson('/api/v1/allocations')
            ->assertOk()
            ->assertJsonPath('meta.filters.clients', []);
    });

    /**
     * The enumeration guard. A client-level actor must not be able to tell a
     * real tenant id from an invented one — the failure ADR-0007 cites, where
     * a validation rule let any employee enumerate the client list one id at
     * a time. Both attempts must fail identically.
     */
    it('gives a client the same refusal for a real foreign client as for an invented one', function () {
        // Granted the ability deliberately: no seeded client role holds it,
        // but roles are editable (ADR-0004), so the rule must still answer.
        $role = Role::query()->where('slug', UserRole::CORPORATE_ADMIN->value)->firstOrFail();
        $role->update(['permissions' => [...$role->permissions, Permission::ALLOCATIONS_MANAGE->value]]);

        // Re-read: `User::permissions()` memoises per instance and resolves
        // through the `roleRecord` relation, so the fixture built in
        // `beforeEach` can answer from before the grant. Without this the
        // requests below are refused by the *policy* at 403 and never reach
        // the validation rule under test — the test would pass while
        // asserting nothing about enumeration.
        $admin = User::findOrFail($this->bankAdmin->id);
        expect($admin->hasPermission(Permission::ALLOCATIONS_MANAGE))->toBeTrue(
            'Precondition: the actor must be able to reach validation, or this proves nothing.',
        );

        $payload = fn (int $tenantId) => [
            'tenant_id' => $tenantId,
            'vehicle_id' => $this->vehicle->id,
            'starts_on' => '2026-09-01',
        ];

        $real = actingAs($admin)->postJson('/api/v1/allocations', $payload($this->ngo->id));
        $invented = actingAs($admin)->postJson('/api/v1/allocations', $payload(999_999));

        $real->assertStatus(422)->assertJsonValidationErrors('tenant_id');
        $invented->assertStatus(422)->assertJsonValidationErrors('tenant_id');

        expect($real->json('errors.tenant_id'))->toBe(
            $invented->json('errors.tenant_id'),
            'A real foreign tenant id must be indistinguishable from an invented one.',
        );
        expect(VehicleAllocation::allTenants()->count())->toBe(0);
    });
});

describe('cross-tenant isolation — the platform half (ADR-0006 mirror)', function () {
    it('shows platform staff every client, named', function () {
        VehicleAllocation::factory()->forTenant($this->bank)->forVehicle($this->vehicle)->create();
        VehicleAllocation::factory()->forTenant($this->ngo)->forVehicle(Vehicle::factory()->create())->create();

        $response = actingAs($this->superAdmin)->getJson('/api/v1/allocations')->assertOk();

        expect($response->json('data'))->toHaveCount(2);
        expect(collect($response->json('data'))->pluck('client.name')->sort()->values()->all())
            ->toBe(['Acme NGO', 'Centenary Bank']);
    });

    /**
     * The mirror half. Belonging to no tenant must not become a permission:
     * a platform user without `allocations.view` sees nothing here, exactly
     * as a client without it would.
     */
    it('shows a platform user without the permission nothing at all', function () {
        VehicleAllocation::factory()->forTenant($this->bank)->forVehicle($this->vehicle)->create();

        $financeRole = Role::query()->where('slug', UserRole::FINANCE->value)->firstOrFail();
        expect($financeRole->permissions)->not->toContain(
            Permission::ALLOCATIONS_VIEW->value,
            'Precondition: Finance is seeded without allocations.view.',
        );

        $finance = User::factory()->notEnrolledInMfa()->create([
            'tenant_id' => null,
            'role' => UserRole::FINANCE,
        ]);

        actingAs($finance)->getJson('/api/v1/allocations')->assertForbidden();
    });
});

describe('ending a contract', function () {
    it('records the day a contract stopped without deleting it', function () {
        $allocation = VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->vehicle)
            ->between('2026-09-01', null)->create();

        actingAs($this->superAdmin)
            ->patchJson("/api/v1/allocations/{$allocation->id}", ['ends_on' => '2026-09-30'])
            ->assertOk()
            ->assertJsonPath('data.ends_on', '2026-09-30');

        // Still there. A contract that ran is a commercial record, and the
        // audit trail depends on it staying readable.
        expect(VehicleAllocation::allTenants()->whereKey($allocation->id)->exists())->toBeTrue();
    });

    it('refuses an end date before the contract started', function () {
        $allocation = VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->vehicle)
            ->between('2026-09-10', null)->create();

        actingAs($this->superAdmin)
            ->patchJson("/api/v1/allocations/{$allocation->id}", ['ends_on' => '2026-09-01'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('ends_on');
    });
});
