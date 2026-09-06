<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;

/**
 * The console must be able to tell a Kangaru account from a fleet account.
 *
 * Until this shipped it could not: `UserResource` sent `tenant_id` and `role`
 * and nothing else about the level, so the one menu it renders was the same
 * menu for head office and for the fleet whose drivers and vehicles head
 * office does not own (ADR-0055 §2). ADR-0059 §1 chooses the menu from this
 * field before role narrows it, and every K package depends on it arriving.
 *
 * These pin the *contract*, not the menu. What the console does with the
 * value is `frontend/src/lib/menu/menu.test.ts`.
 */
it('tells the console which level the signed-in account belongs to', function () {
    $operator = Operator::query()->firstOrFail();

    $user = User::factory()->create([
        'role' => UserRole::DISPATCHER,
        'tenant_id' => null,
        'operator_id' => $operator->id,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.access_level', 'fleet');
});

/**
 * The field is the whole point of ADR-0055 §4, so a resource that flattened
 * every level to one string would be worse than not sending it: the menu
 * would be chosen confidently and wrongly.
 */
it('distinguishes the levels rather than sending one word for all of them', function () {
    $operator = Operator::query()->firstOrFail();
    $tenant = Tenant::factory()->create();

    $cases = [
        AccessLevel::KANGARU->value => ['tenant_id' => null, 'operator_id' => null, 'access_level' => AccessLevel::KANGARU],
        AccessLevel::FLEET->value => ['tenant_id' => null, 'operator_id' => $operator->id, 'access_level' => AccessLevel::FLEET],
        AccessLevel::CLIENT->value => ['tenant_id' => $tenant->id, 'operator_id' => null, 'access_level' => AccessLevel::CLIENT],
    ];

    foreach ($cases as $expected => $columns) {
        $user = User::factory()->create([
            'role' => $expected === AccessLevel::CLIENT->value ? UserRole::CORPORATE_ADMIN : UserRole::SUPER_ADMIN,
            ...$columns,
        ]);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.access_level', $expected);
    }
});

/**
 * The chrome has to tell all three levels apart, and `tenant_id` cannot do it:
 * it is null for a fleet account and null for a Kangaru account alike, so the
 * topbar said "Platform" to both. A Super Admin at Shanitah and a Super Admin
 * at head office got an identical chip and two different menus.
 */
it('names the fleet a person works for, so the chrome can say whose console this is', function () {
    $operator = Operator::query()->firstOrFail();

    $user = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'tenant_id' => null,
        'operator_id' => $operator->id,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.operator_name', $operator->name)
        ->assertJsonPath('data.tenant_name', null);
});

/**
 * Head office belongs to no fleet, so the field is null rather than absent —
 * and the console reads that as "this is Kangaru" rather than as missing data.
 */
it('names no fleet for head office, which belongs to none', function () {
    $user = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
    ]);

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.operator_name', null)
        ->assertJsonPath('data.access_level', 'kangaru');
});

/**
 * `UserResource` is nested on bookings, trip events and audit rows as the
 * actor. `access_level` is a column rather than a relation, so it costs no
 * query there — but a resource that only sent it on `/auth/me` would leave
 * every other surface unable to answer the same question, which is how a
 * field ends up re-derived somewhere it should not be.
 */
it('sends the level wherever a user is nested, not only on /auth/me', function () {
    $operator = Operator::query()->firstOrFail();

    $admin = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'tenant_id' => null,
        'operator_id' => $operator->id,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/users')
        ->assertOk()
        ->assertJsonPath('data.0.access_level', fn (?string $level) => $level !== null);
});
