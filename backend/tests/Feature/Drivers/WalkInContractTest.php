<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverWalkInContract;
use Modules\Drivers\Services\WalkInContractService;

/**
 * A driver's contract with Kangaru for walk-in work (`K8`, ADR-0055 §5).
 *
 * The owner: *"each driver regardless of the Fleet company can request to be
 * part of our Walkin economy."*
 *
 * The happy path is three lines. **What these mostly pin is that no party may
 * perform another's step** — and the one that would collapse the feature is at
 * the bottom: if a driver could reach the approval, every driver on the
 * platform is contracted the moment they ask, and their fleet is never
 * consulted at all.
 */
function walkInActor(string $level, ?int $operatorId = null): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => $level === 'fleet' ? ($operatorId ?? Operator::SHANITAH) : null,
        'access_level' => $level === 'fleet' ? AccessLevel::FLEET : AccessLevel::KANGARU,
    ]);
}

function askingDriver(bool $ownsVehicle = false, ?int $operatorId = null): DriverWalkInContract
{
    $driver = Driver::factory()->create([
        'operator_id' => $operatorId ?? Operator::SHANITAH,
        'owns_vehicle' => $ownsVehicle,
    ]);

    return app(WalkInContractService::class)->request($driver);
}

/*
|--------------------------------------------------------------------------
| Asking
|--------------------------------------------------------------------------
*/

it('starts a fleet driver waiting on their own fleet', function () {
    $contract = askingDriver();

    expect($contract->status)->toBe(DriverWalkInContract::REQUESTED)
        ->and($contract->operator_id)->toBe(Operator::SHANITAH)
        ->and($contract->fleet_answered_at)->toBeNull();
});

/**
 * ADR-0055 §5 waives fleet consent where the driver owns the vehicle, because
 * there is no fleet to ask. Expressed through `drivers.owns_vehicle`
 * (ADR-0048 §7) rather than a second column recording the same fact — two
 * columns for one truth eventually disagree.
 */
it('sends a driver-partner straight to Kangaru, having no fleet to ask', function () {
    $contract = askingDriver(ownsVehicle: true);

    expect($contract->status)->toBe(DriverWalkInContract::AWAITING_KANGARU)
        ->and($contract->operator_id)->toBeNull()
        ->and($contract->fleet_answered_at)->not->toBeNull();
});

it('does not queue a second request when a driver asks twice', function () {
    $contract = askingDriver();
    $again = app(WalkInContractService::class)->request($contract->driver);

    expect($again->id)->toBe($contract->id)
        ->and(DriverWalkInContract::query()->where('driver_id', $contract->driver_id)->count())->toBe(1);
});

it('lets a refused driver ask again, reusing the row', function () {
    $contract = askingDriver();
    app(WalkInContractService::class)->refuse($contract, 'Not this season.');

    $again = app(WalkInContractService::class)->request($contract->driver);

    expect($again->id)->toBe($contract->id)
        ->and($again->status)->toBe(DriverWalkInContract::REQUESTED)
        ->and($again->refused_reason)->toBeNull();
});

/*
|--------------------------------------------------------------------------
| The chain, in order
|--------------------------------------------------------------------------
*/

it('runs ask, consent, approve', function () {
    $contract = askingDriver();

    $this->actingAs(walkInActor('fleet'), 'sanctum')
        ->postJson("/api/v1/walk-in-contracts/{$contract->id}/consent")
        ->assertOk()
        ->assertJsonPath('data.status', DriverWalkInContract::AWAITING_KANGARU);

    $this->actingAs(walkInActor('kangaru'), 'sanctum')
        ->postJson("/api/v1/walk-in-contracts/{$contract->id}/approval")
        ->assertOk()
        ->assertJsonPath('data.status', DriverWalkInContract::ACTIVE);

    expect($contract->refresh()->isLive())->toBeTrue();
});

/**
 * **The one that would collapse the feature.**
 *
 * `approve` refuses anything not already consented, so reaching it early is a
 * 422 even for head office — the party that may legitimately call it. Without
 * this, a request could skip its fleet entirely and the consent step would be
 * decorative.
 */
it('refuses an approval that skips the fleet, even from head office', function () {
    $contract = askingDriver();

    expect(fn () => app(WalkInContractService::class)->approve($contract))
        ->toThrow(ValidationException::class);

    expect($contract->refresh()->status)->toBe(DriverWalkInContract::REQUESTED);
});

it('refuses a consent once Kangaru has already answered', function () {
    $contract = askingDriver();
    app(WalkInContractService::class)->consent($contract);
    app(WalkInContractService::class)->approve($contract);

    expect(fn () => app(WalkInContractService::class)->consent($contract))
        ->toThrow(ValidationException::class);
});

/*
|--------------------------------------------------------------------------
| Who may answer — no party performs another's step
|--------------------------------------------------------------------------
*/

it('refuses a fleet the approval, which is Kangaru s', function () {
    $contract = askingDriver();
    app(WalkInContractService::class)->consent($contract);

    $this->actingAs(walkInActor('fleet'), 'sanctum')
        ->postJson("/api/v1/walk-in-contracts/{$contract->id}/approval")
        ->assertForbidden();

    expect($contract->refresh()->status)->toBe(DriverWalkInContract::AWAITING_KANGARU);
});

/**
 * Head office cannot consent on a fleet's behalf. It may approve, and only
 * after somebody else has agreed — otherwise "the fleet consents" is a
 * sentence in an ADR and nothing in the code.
 */
it("refuses head office the fleet's consent", function () {
    $contract = askingDriver();

    $this->actingAs(walkInActor('kangaru'), 'sanctum')
        ->postJson("/api/v1/walk-in-contracts/{$contract->id}/consent")
        ->assertForbidden();

    expect($contract->refresh()->status)->toBe(DriverWalkInContract::REQUESTED);
});

/**
 * The contract's own `operator_id`, not the driver's current one. A driver who
 * moves employer must not hand their consent decision to whoever they work for
 * now.
 */
it('refuses another fleet the consent, even for a driver it now employs', function () {
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k8', 'status' => 'active']);
    $contract = askingDriver();

    // The driver moves. The contract still names the fleet that was asked.
    $contract->driver->update(['operator_id' => $rival->id]);

    $this->actingAs(walkInActor('fleet', $rival->id), 'sanctum')
        ->postJson("/api/v1/walk-in-contracts/{$contract->id}/consent")
        ->assertForbidden();

    expect($contract->refresh()->status)->toBe(DriverWalkInContract::REQUESTED);
});

/*
|--------------------------------------------------------------------------
| Refusing, and which answer it was
|--------------------------------------------------------------------------
*/

it('stamps a fleet refusal as the fleet s answer, not Kangaru s', function () {
    $contract = askingDriver();

    $this->actingAs(walkInActor('fleet'), 'sanctum')
        ->postJson("/api/v1/walk-in-contracts/{$contract->id}/refusal", ['reason' => 'Needed on corporate work.'])
        ->assertOk();

    $contract->refresh();

    expect($contract->status)->toBe(DriverWalkInContract::REFUSED)
        ->and($contract->fleet_answered_at)->not->toBeNull()
        // The fleet cannot stamp Kangaru's answer by calling the wrong verb:
        // the service picks the timestamp from the state, not the caller.
        ->and($contract->kangaru_answered_at)->toBeNull()
        ->and($contract->refused_reason)->toBe('Needed on corporate work.');
});

it("stamps Kangaru's refusal as Kangaru's answer", function () {
    $contract = askingDriver();
    app(WalkInContractService::class)->consent($contract);

    $this->actingAs(walkInActor('kangaru'), 'sanctum')
        ->postJson("/api/v1/walk-in-contracts/{$contract->id}/refusal")
        ->assertOk();

    $contract->refresh();

    expect($contract->kangaru_answered_at)->not->toBeNull()
        ->and($contract->status)->toBe(DriverWalkInContract::REFUSED);
});

/*
|--------------------------------------------------------------------------
| The two queues
|--------------------------------------------------------------------------
*/

it('shows a fleet only what is waiting on its own consent', function () {
    $mine = askingDriver();

    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k8b', 'status' => 'active']);
    $theirs = askingDriver(operatorId: $rival->id);

    $ids = collect($this->actingAs(walkInActor('fleet'), 'sanctum')
        ->getJson('/api/v1/walk-in-contracts')->assertOk()->json('data'))->pluck('id');

    expect($ids)->toContain($mine->id)->and($ids)->not->toContain($theirs->id);
});

/**
 * Head office's queue is what has been **consented** and is waiting on them —
 * not everything ever asked. A request its fleet has not answered is not head
 * office's to look at yet.
 */
it('shows head office what is consented and waiting, and not what is not', function () {
    $waitingOnFleet = askingDriver();
    $waitingOnKangaru = askingDriver();
    app(WalkInContractService::class)->consent($waitingOnKangaru);

    $ids = collect($this->actingAs(walkInActor('kangaru'), 'sanctum')
        ->getJson('/api/v1/walk-in-contracts')->assertOk()->json('data'))->pluck('id');

    expect($ids)->toContain($waitingOnKangaru->id)
        ->and($ids)->not->toContain($waitingOnFleet->id);
});

it('names whether consent was waived, so a driver-partner is not read as a data error', function () {
    $partner = askingDriver(ownsVehicle: true);

    $row = collect($this->actingAs(walkInActor('kangaru'), 'sanctum')
        ->getJson('/api/v1/walk-in-contracts')->assertOk()->json('data'))
        ->firstWhere('id', $partner->id);

    expect($row['fleet'])->toBeNull()
        ->and($row['driver']['owns_vehicle'])->toBeTrue();
});
