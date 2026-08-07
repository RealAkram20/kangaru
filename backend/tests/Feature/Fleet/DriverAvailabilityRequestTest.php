<?php

use App\Enums\UserRole;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Services\AvailabilityService;

/**
 * ADR-0017 §6, completed — a driver asking for time off.
 *
 * The office half shipped with ADR-0017: it records blocks and answers
 * requests. The asking never existed, because `POST /availability-blocks`
 * needs `drivers.manage` — a permission that also lets you edit anybody's
 * profile, and one the driver role must not hold. The Driver's Application
 * hit this immediately.
 *
 * What matters here is that a driver can only ever ask about **themselves**,
 * and can only ever ask — never grant.
 */
function driverAccountWithProfile(): array
{
    $account = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->forUser($account)->create();

    return [$account, $driver];
}

function askForLeave(User $account, array $overrides = [])
{
    return test()->actingAs($account, 'sanctum')->postJson('/api/v1/me/availability-requests', [
        'kind' => 'leave',
        'starts_at' => '2026-09-01 00:00:00',
        'ends_at' => '2026-09-03 00:00:00',
        'reason' => 'Family funeral upcountry.',
        ...$overrides,
    ]);
}

// ── Asking ───────────────────────────────────────────────────────────────

it('lets a driver ask for time off', function () {
    [$account, $driver] = driverAccountWithProfile();

    askForLeave($account)
        ->assertCreated()
        ->assertJsonPath('data.status', 'requested')
        ->assertJsonPath('data.resource_id', $driver->id);
});

it('does not take the driver off the roster just because they asked', function () {
    [$account, $driver] = driverAccountWithProfile();

    askForLeave($account)->assertCreated();

    // Only `approved` withholds anybody (ADR-0017 §6). If asking were
    // enough, any driver could leave the roster unilaterally and the fleet
    // would find out at 6am.
    expect(app(AvailabilityService::class)->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-02 08:00:00'),
        CarbonImmutable::parse('2026-09-02 10:00:00'),
    )->free)->toBeTrue();
});

it('withholds the driver once the office approves', function () {
    [$account, $driver] = driverAccountWithProfile();

    $id = askForLeave($account)->assertCreated()->json('data.id');

    $office = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    test()->actingAs($office, 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$id}/answer", ['status' => 'approved'])
        ->assertOk();

    expect(app(AvailabilityService::class)->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-02 08:00:00'),
        CarbonImmutable::parse('2026-09-02 10:00:00'),
    )->free)->toBeFalse();
});

// ── The security properties ──────────────────────────────────────────────

it('gives a driver no way to ask on somebody else\'s behalf', function () {
    [$account, $mine] = driverAccountWithProfile();
    $colleague = Driver::factory()->create();

    // These fields do not exist on the request. Sending them must change
    // nothing — the block is pinned to the caller's own profile by the
    // controller, not by a validation rule somebody could forget.
    askForLeave($account, [
        'resource_id' => $colleague->id,
        'resource_type' => 'vehicle',
    ])->assertCreated();

    $block = AvailabilityBlock::query()->latest('id')->first();

    expect($block->resource_id)->toBe($mine->id);
    expect($block->resource_type)->toBe(AvailabilityResource::DRIVER);
});

it('gives a driver no way to approve their own request', function () {
    [$account] = driverAccountWithProfile();

    askForLeave($account, ['status' => 'approved'])->assertCreated();

    expect(AvailabilityBlock::query()->latest('id')->first()->status)
        ->toBe(AvailabilityStatus::REQUESTED);
});

it('refuses a driver the office endpoint that would let them approve it', function () {
    [$account] = driverAccountWithProfile();

    $id = askForLeave($account)->assertCreated()->json('data.id');

    // The answer endpoint is `drivers.manage`, which a driver does not hold.
    test()->actingAs($account, 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$id}/answer", ['status' => 'approved'])
        ->assertForbidden();
});

it('shows a driver only their own requests', function () {
    [$account, $mine] = driverAccountWithProfile();
    $colleague = Driver::factory()->create();

    askForLeave($account)->assertCreated();
    AvailabilityBlock::factory()->forDriver($colleague)->requested()->create();

    $rows = test()->actingAs($account, 'sanctum')
        ->getJson('/api/v1/me/availability-requests')->assertOk()->json('data');

    expect($rows)->toHaveCount(1);
    expect($rows[0]['resource_id'])->toBe($mine->id);
});

it('turns away an account with no driver profile behind it', function () {
    // An operations manager opening the driver app. The feature exists;
    // this account simply is not a driver, so the code says so rather than
    // 404ing as though the endpoint were missing.
    $office = User::factory()->create(['tenant_id' => null, 'role' => UserRole::OPERATIONS_MANAGER]);

    test()->actingAs($office, 'sanctum')
        ->getJson('/api/v1/me/availability-requests')
        ->assertForbidden()
        ->assertJsonPath('code', 'NOT_A_DRIVER');
});

it('requires a signed-in caller', function () {
    test()->getJson('/api/v1/me/availability-requests')->assertUnauthorized();
    test()->postJson('/api/v1/me/availability-requests', [])->assertUnauthorized();
});

// ── Withdrawing ──────────────────────────────────────────────────────────

it('lets a driver withdraw a request nobody has answered', function () {
    [$account] = driverAccountWithProfile();

    $id = askForLeave($account)->assertCreated()->json('data.id');

    test()->actingAs($account, 'sanctum')
        ->deleteJson("/api/v1/me/availability-requests/{$id}")
        ->assertNoContent();
});

it('refuses to withdraw one the office has already answered', function () {
    [$account] = driverAccountWithProfile();

    $id = askForLeave($account)->assertCreated()->json('data.id');

    $office = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    test()->actingAs($office, 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$id}/answer", ['status' => 'approved'])->assertOk();

    // Deleting an approval would silently put the driver back on the roster
    // with nobody knowing the decision had been undone.
    test()->actingAs($account, 'sanctum')
        ->deleteJson("/api/v1/me/availability-requests/{$id}")
        ->assertStatus(409)
        ->assertJsonPath('code', 'AVAILABILITY_ALREADY_ANSWERED');
});

it('hides another driver\'s request behind a 404 rather than a 403', function () {
    [$account] = driverAccountWithProfile();
    $colleague = Driver::factory()->create();
    $theirs = AvailabilityBlock::factory()->forDriver($colleague)->requested()->create();

    // 403 would confirm the row exists. Another person's rows are not
    // theirs to know about.
    test()->actingAs($account, 'sanctum')
        ->deleteJson("/api/v1/me/availability-requests/{$theirs->id}")
        ->assertNotFound();

    expect(AvailabilityBlock::query()->whereKey($theirs->id)->exists())->toBeTrue();
});

// ── Validation ───────────────────────────────────────────────────────────

it('will not let a driver book a van in for maintenance', function () {
    [$account] = driverAccountWithProfile();

    // A person does not go in for maintenance. Allowing it would make the
    // utilisation split between "lost to the workshop" and "lost to leave"
    // meaningless.
    askForLeave($account, ['kind' => 'maintenance'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('kind');
});

it('asks for a reason the office can actually read', function () {
    [$account] = driverAccountWithProfile();

    askForLeave($account, ['reason' => ''])->assertStatus(422)->assertJsonValidationErrors('reason');
    askForLeave($account, ['reason' => 'x'])->assertStatus(422)->assertJsonValidationErrors('reason');
});

it('accepts an open-ended request, which is a real thing to ask for', function () {
    [$account] = driverAccountWithProfile();

    // "Off from Friday, back when the funeral is over" — the office pins
    // the end date when it answers.
    askForLeave($account, ['ends_at' => null])->assertCreated();
});
