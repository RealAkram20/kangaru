<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\Plan;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Services\PlanAllowance;

/**
 * What a fleet's plan lets it add (`K7`, ADR-0058 §4).
 *
 * ADR-0058 writes the rule as three prohibitions rather than one sentence,
 * because each is a mistake somebody will otherwise make. Each has a test
 * here, and the first is the one that would do real damage:
 *
 * > **A limit blocks adding. It never removes, disables or breaks what already
 * > exists.**
 */
function fleetOn(Plan $plan): Operator
{
    return Operator::create([
        'name' => 'Test Fleet '.fake()->unique()->numerify('###'),
        'slug' => 'test-fleet-'.fake()->unique()->numerify('###'),
        'status' => 'active',
        'plan_id' => $plan->id,
    ]);
}

function planWith(array $limits): Plan
{
    return Plan::create([
        'slug' => 'plan-'.fake()->unique()->numerify('###'),
        'name' => $limits['name'] ?? 'Test plan',
        'is_default' => false,
        'price_minor' => 0,
        'currency' => 'UGX',
        'period' => 'none',
        ...$limits,
    ]);
}

function driversFor(Operator $operator, int $count): void
{
    Driver::factory()->count($count)->create(['operator_id' => $operator->id]);
}

function planHeadOffice(): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
    ]);
}

it('lets a fleet add while it is under the ceiling', function () {
    $fleet = fleetOn(planWith(['driver_limit' => 3]));
    driversFor($fleet, 2);

    expect(app(PlanAllowance::class)->allows($fleet, PlanAllowance::DRIVERS))->toBeTrue();
});

it('refuses the one that would cross it', function () {
    $fleet = fleetOn(planWith(['driver_limit' => 3]));
    driversFor($fleet, 3);

    expect(app(PlanAllowance::class)->allows($fleet, PlanAllowance::DRIVERS))->toBeFalse();
});

/**
 * **Prohibition 1, and the one that would do real damage.**
 *
 * A fleet over its limit — through a downgrade, an imported roster, a lowered
 * ceiling — keeps every driver working. Their drivers accept jobs, their trips
 * complete, their wallets settle. Exceeding a limit never sets a status on
 * anything.
 */
it('leaves every existing driver working when a fleet is over its limit', function () {
    $fleet = fleetOn(planWith(['driver_limit' => 10]));
    driversFor($fleet, 11);

    $before = Driver::withoutGlobalScopes()->where('operator_id', $fleet->id)->get();

    // Asking the question must not be a write.
    app(PlanAllowance::class)->allows($fleet, PlanAllowance::DRIVERS);

    $after = Driver::withoutGlobalScopes()->where('operator_id', $fleet->id)->get();

    expect($after)->toHaveCount(11)
        ->and($after->pluck('status')->unique()->all())->toBe($before->pluck('status')->unique()->all());
});

/**
 * Null is unlimited, and this is the case that would break first if a caller
 * compared against it directly: `$count >= null` is true for every count in
 * PHP, so a naive check refuses the **first** driver a grandfathered fleet
 * ever hires.
 */
it('treats a plan with no ceiling as unlimited, not as nought', function () {
    $fleet = fleetOn(planWith(['driver_limit' => null, 'name' => 'Founding']));
    driversFor($fleet, 40);

    expect(app(PlanAllowance::class)->allows($fleet, PlanAllowance::DRIVERS))->toBeTrue();
});

/**
 * ADR-0058 §1: a fleet created with no plan named gets the default, and there
 * is **no such thing as a planless fleet**.
 *
 * Written as an assertion about the invariant rather than about the guard,
 * because the guard turned out to be unreachable — `Operator::creating` fills
 * `plan_id` from `is_default` before the row exists, so a test that made a
 * fleet with `plan_id => null` was quietly testing a fleet on Free.
 *
 * `PlanAllowance` still fails closed on a null plan and that branch stays: it
 * is cheap defence against the invariant being weakened later. It is
 * deliberately **not** what this test pins, for the same reason the
 * `mfaEnforced()` coalesce is not what its test pins — an unreachable guard
 * that looks load-bearing is worse than none.
 */
it('gives a fleet the default plan rather than letting it have none', function () {
    $fleet = Operator::create([
        'name' => 'Planless', 'slug' => 'planless-k7', 'status' => 'active',
    ]);

    expect($fleet->plan_id)->not->toBeNull()
        ->and($fleet->plan->is_default)->toBeTrue();
});

/**
 * **Prohibition 2.** The refusal happens at the point of adding, with a 422
 * that names the plan and the number — not deep in dispatch, where a driver
 * unable to get a job is a support call that takes an hour to diagnose.
 */
it('refuses the eleventh driver at the moment of hiring, and says why', function () {
    $fleet = fleetOn(planWith(['driver_limit' => 1, 'name' => 'Free']));
    driversFor($fleet, 1);

    $actor = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => $fleet->id,
        'access_level' => AccessLevel::FLEET,
    ]);

    $response = $this->actingAs($actor, 'sanctum')->postJson('/api/v1/drivers', [
        'name' => 'Joseph Okello',
        'phone' => '+256700'.fake()->unique()->numerify('######'),
        // The request's own spelling — , and both fields required.
        // An earlier payload used the British spelling and no expiry, so the
        // form refused it before the plan check was ever reached, and the test
        // read as though the limit had fired.
        'license_number' => 'UG-'.fake()->unique()->numerify('######'),
        'license_expiry' => now()->addYear()->toDateString(),
    ]);

    $response->assertStatus(422);
    expect(json_encode($response->json()))->toContain('Free')->toContain('1');
});

/*
|--------------------------------------------------------------------------
| Prohibition 3 — a downgrade below current usage is refused, not enforced
|--------------------------------------------------------------------------
*/

it('names every resource that blocks a downgrade, with its figures', function () {
    $fleet = fleetOn(planWith(['driver_limit' => null]));
    driversFor($fleet, 5);

    $blockers = app(PlanAllowance::class)->blockers($fleet, planWith(['driver_limit' => 2]));

    expect($blockers)->toHaveKey(PlanAllowance::DRIVERS)
        ->and($blockers[PlanAllowance::DRIVERS])->toBe(['limit' => 2, 'current' => 5]);
});

it('blocks nothing when the new plan is roomy enough', function () {
    $fleet = fleetOn(planWith(['driver_limit' => null]));
    driversFor($fleet, 5);

    expect(app(PlanAllowance::class)->blockers($fleet, planWith(['driver_limit' => 50])))->toBe([]);
});

it('refuses the downgrade over the API, naming the figures rather than cutting drivers', function () {
    $fleet = fleetOn(planWith(['driver_limit' => null]));
    driversFor($fleet, 5);
    $smaller = planWith(['driver_limit' => 2, 'name' => 'Free']);

    $response = $this->actingAs(planHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$fleet->id}/plan", ['plan_id' => $smaller->id])
        ->assertStatus(422);

    expect(json_encode($response->json()))->toContain('Free')->toContain('2')->toContain('5');

    // Neither the plan nor a single driver moved.
    expect($fleet->refresh()->plan_id)->not->toBe($smaller->id)
        ->and(Driver::withoutGlobalScopes()->where('operator_id', $fleet->id)->count())->toBe(5);
});

it('lets head office move a fleet onto a plan that fits', function () {
    $fleet = fleetOn(planWith(['driver_limit' => 2]));
    driversFor($fleet, 1);
    $bigger = planWith(['driver_limit' => null, 'name' => 'Scale']);

    $this->actingAs(planHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$fleet->id}/plan", ['plan_id' => $bigger->id])
        ->assertOk();

    expect($fleet->refresh()->plan_id)->toBe($bigger->id);
});

/**
 * It is Kangaru's commercial relationship with that fleet, not the fleet's own
 * to edit — otherwise a fleet on Free moves itself to unlimited.
 */
it('refuses a fleet its own plan change', function () {
    $fleet = fleetOn(planWith(['driver_limit' => 2]));
    $bigger = planWith(['driver_limit' => null]);

    $actor = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => $fleet->id,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($actor, 'sanctum')
        ->putJson("/api/v1/operators/{$fleet->id}/plan", ['plan_id' => $bigger->id])
        ->assertForbidden();

    expect($fleet->refresh()->plan_id)->not->toBe($bigger->id);
});

it('serves the catalogue with unlimited as null, never as a number', function () {
    $rows = $this->actingAs(planHeadOffice(), 'sanctum')
        ->getJson('/api/v1/plans')->assertOk()->json('data');

    $founding = collect($rows)->firstWhere('slug', 'founding-fleet');

    expect($founding['driver_limit'])->toBeNull();
});
