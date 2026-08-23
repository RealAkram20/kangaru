<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\User;

/**
 * What head office sees when it signs in (`K4`, ADR-0059).
 *
 * The load-bearing property is not that the numbers are right — it is that
 * **they are only numbers**. ADR-0055 §2 leaves no account able to read every
 * fleet's data in one query, Super Admin included, so a list here would be
 * the breach the whole model was built to prevent. `docs/platform-plan.md` §6
 * q4 flagged that the difference between a count and a list is one endpoint.
 */
function overviewActor(string $level): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => $level === 'fleet' ? Operator::SHANITAH : null,
        'access_level' => $level === 'fleet' ? AccessLevel::FLEET : AccessLevel::KANGARU,
    ]);
}

it('answers head office with counts of the network', function () {
    $this->actingAs(overviewActor('kangaru'), 'sanctum')
        ->getJson('/api/v1/kangaru/overview')
        ->assertOk()
        ->assertJsonPath('data.network.fleets', fn ($v) => is_int($v))
        ->assertJsonPath('data.network.clients', fn ($v) => is_int($v))
        ->assertJsonPath('data.queues.driver_applications', fn ($v) => is_int($v))
        ->assertJsonPath('data.governance.acting_as_now', fn ($v) => is_int($v));
});

/**
 * The guard that matters. Every value in the payload must be a scalar — no
 * array anywhere, at any depth beyond the three named groups. A regression
 * that added `'clients' => Tenant::all()` would still be "a working
 * dashboard" and would be a cross-fleet read of every client on the platform.
 */
it('returns numbers and never a row, at any depth', function () {
    $data = $this->actingAs(overviewActor('kangaru'), 'sanctum')
        ->getJson('/api/v1/kangaru/overview')
        ->assertOk()
        ->json('data');

    expect(array_keys($data))->toBe(['network', 'queues', 'governance']);

    foreach ($data as $group => $values) {
        foreach ($values as $key => $value) {
            expect($value)->toBeInt("{$group}.{$key} must be a count, never a row");
        }
    }
});

/**
 * A fleet's own Super Admin holds every permission there is and still has no
 * business in head office's overview — it counts other operators. That is a
 * level question, and no role list can answer it (ADR-0059 §1).
 */
it("refuses a fleet's super admin, who holds every permission", function () {
    $this->actingAs(overviewActor('fleet'), 'sanctum')
        ->getJson('/api/v1/kangaru/overview')
        ->assertForbidden();
});

it('refuses a caller with no account at all', function () {
    $this->getJson('/api/v1/kangaru/overview')->assertUnauthorized();
});

/**
 * ADR-0059 §5: a fleet with no account is unreachable to support for ever.
 * Onboarding creates one in the same transaction, so this figure should be
 * nought — which is exactly why it is shown. A number here means the
 * invariant has been broken somewhere.
 */
it('counts fleets nobody can act as, so a broken invariant is visible', function () {
    $orphan = Operator::create([
        'name' => 'Orphaned Transport Ltd',
        'slug' => 'orphaned-transport-k4',
        'status' => 'active',
    ]);

    $this->actingAs(overviewActor('kangaru'), 'sanctum')
        ->getJson('/api/v1/kangaru/overview')
        ->assertOk()
        ->assertJsonPath('data.queues.fleets_without_an_account', fn (int $n) => $n >= 1);

    expect($orphan->users()->count())->toBe(0);
});
