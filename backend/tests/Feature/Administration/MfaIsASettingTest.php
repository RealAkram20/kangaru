<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Modules\Administration\Models\Role;
use Modules\Administration\Models\Setting;
use Modules\Administration\Services\SettingsService;

/**
 * The second factor is a setting, not a constant (ADR-0061).
 *
 * `roles.requires_mfa` was editable only by `RoleSeeder` since ADR-0004 — no
 * request field, no resource field, no control anywhere. It was changed by
 * hand three times, and on 22 August it changed as a **side effect of
 * granting an unrelated permission**: re-seeding roles to pick up
 * `fleets.view` rewrote the column and put three console accounts into "must
 * enrol".
 *
 * The rule these pin: **two switches, one resolved answer.** Nothing outside
 * `User::requiresMfa()` may read either, because two callers combining two
 * gates themselves is how they drift — and the drift is invisible, since
 * somebody in the half-state signs in with a 200 *and a token* and is then
 * refused every route but five.
 */
function mfaUser(string $level = 'kangaru'): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => $level === 'fleet' ? Operator::SHANITAH : null,
        'access_level' => $level === 'fleet' ? AccessLevel::FLEET : AccessLevel::KANGARU,
    ]);
}

function setEnforced(bool $on): void
{
    app(SettingsService::class)->setGroup('auth', ['mfa_enforced' => $on]);
}

beforeEach(function () {
    Role::query()->where('slug', 'super_admin')->update(['requires_mfa' => true]);
    setEnforced(true);
});

it('asks for a second factor when both switches say so', function () {
    expect(mfaUser()->requiresMfa())->toBeTrue();
});

/**
 * The master switch relaxes; the per-role answer is untouched underneath it,
 * so turning it back on returns every role to what it already said
 * (ADR-0061 §2).
 */
it('stops asking when the platform switch is off, without changing the role', function () {
    setEnforced(false);

    expect(mfaUser()->requiresMfa())->toBeFalse()
        ->and(Role::query()->where('slug', 'super_admin')->value('requires_mfa'))->toBeTrue();

    setEnforced(true);

    expect(mfaUser()->requiresMfa())->toBeTrue();
});

it('stops asking when the role does not, even with the platform switch on', function () {
    Role::query()->where('slug', 'super_admin')->update(['requires_mfa' => false]);

    expect(mfaUser()->requiresMfa())->toBeFalse();
});

/**
 * The failure direction: an absent row means **ask for the factor**.
 *
 * What actually guarantees it is the **catalogue default**, not the
 * null-coalesce in `mfaEnforced()` — `all()` fills every key from the
 * catalogue, so `get()` can never return null. Established by mutation:
 * removing the coalesce changes nothing here, flipping the catalogue default
 * to `false` turns this red. The comment in the service says so too, because
 * an unreachable guard that looks load-bearing is worse than none.
 */
it('asks for the factor when the setting is missing entirely', function () {
    Setting::query()->where('group', 'auth')->where('key', 'mfa_enforced')->delete();

    // Forgetting the one key rather than `Cache::flush()`. Flushing the whole
    // store here turns the *rest of the suite* red with a missing `migrations`
    // table — found by running this file beside another and watching five
    // tests that pass alone fail together.
    //
    // Without a bust of some kind this passes for the wrong reason: the value
    // cached in `beforeEach` is still `true`, so it would assert nothing about
    // the missing row at all.
    Cache::forget('settings.all:kangaru');

    expect(app(SettingsService::class)->mfaEnforced())->toBeTrue()
        ->and(mfaUser()->requiresMfa())->toBeTrue();
});

/**
 * ADR-0061 §5: a control that weakens authentication must not be reachable by
 * the account it would weaken.
 */
it("refuses a fleet's super admin the second-factor switch", function () {
    $role = Role::query()->where('slug', 'dispatcher')->sole();

    $this->actingAs(mfaUser('fleet'), 'sanctum')
        ->patchJson("/api/v1/roles/{$role->slug}", ['requires_mfa' => true])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['requires_mfa']);

    expect($role->refresh()->requires_mfa)->toBeFalse();
});

/**
 * Switching a factor **off** is the direction that most needs refusing, and a
 * guard that blocked only the safe direction would be worse than none. This
 * is the case that would catch a `->has()` narrowed to a truthy check.
 */
it("refuses a fleet's super admin switching a factor OFF, not just on", function () {
    Role::query()->where('slug', 'dispatcher')->update(['requires_mfa' => true]);
    $role = Role::query()->where('slug', 'dispatcher')->sole();

    $this->actingAs(mfaUser('fleet'), 'sanctum')
        ->patchJson("/api/v1/roles/{$role->slug}", ['requires_mfa' => false])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['requires_mfa']);

    expect($role->refresh()->requires_mfa)->toBeTrue();
});

it('lets head office change it, which is the whole point', function () {
    $role = Role::query()->where('slug', 'dispatcher')->sole();

    $this->actingAs(mfaUser(), 'sanctum')
        ->patchJson("/api/v1/roles/{$role->slug}", ['requires_mfa' => true])
        ->assertOk()
        ->assertJsonPath('data.requires_mfa', true);

    expect($role->refresh()->requires_mfa)->toBeTrue();
});

/**
 * ADR-0061 §4. The count is the safety of this feature: without it the switch
 * is a trap that fires later, on somebody else, at a moment nobody connects
 * to this action.
 */
it('counts the people a switch would ask to enrol, before it is thrown', function () {
    User::factory()->count(2)->create([
        'role' => UserRole::DISPATCHER,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'mfa_confirmed_at' => null,
    ]);

    $body = $this->actingAs(mfaUser(), 'sanctum')
        ->getJson('/api/v1/roles')
        ->assertOk()
        ->json('data');

    $dispatcher = collect($body)->firstWhere('slug', 'dispatcher');

    expect($dispatcher['unenrolled_count'])->toBeGreaterThanOrEqual(2);
});

/**
 * The setting is not public, and the reason is worth a test rather than a
 * comment: the login screen must not advertise that the platform's second
 * factor is switched off.
 */
it('never tells an anonymous visitor whether the second factor is on', function () {
    setEnforced(false);

    $body = $this->getJson('/api/v1/public/settings')->assertOk()->json();

    expect(json_encode($body))->not->toContain('mfa_enforced');
});
