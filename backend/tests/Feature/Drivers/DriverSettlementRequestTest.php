<?php

use App\Enums\UserRole;
use App\Models\User;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Enums\SettlementRequestKind;
use Modules\Drivers\Enums\SettlementRequestStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Drivers\Services\DriverLedgerService;

/**
 * Settlement requests (ADR-0032) — the loop ADR-0029 §6 left open.
 *
 * §6 said the office would write `settlement` entries when cash changed
 * hands, and nothing ever could: `recordSettlement()` had no caller outside a
 * seeder. A driver could see what they owed and had no way to tell anyone
 * they had paid it.
 *
 * The properties worth pinning are all about money not moving twice, and
 * about a request never being mistaken for a balance:
 *
 * - **A pending request changes no balance.** If it did, a driver could
 *   request their way out of what they owe.
 * - **Confirming writes exactly one ledger entry**, with the sign derived
 *   from the request's kind, and is idempotent under a replay.
 * - **One open request per kind** — two pending payouts are one driver
 *   asking twice.
 * - **A driver cannot confirm their own request**, which would make the whole
 *   thing a self-service withdrawal.
 */
function settlementDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

/** Somebody at the office who may answer requests (`drivers.manage`). */
function settlementStaff(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

/** Puts a driver into debt the way a cash trip does. */
function oweTheOffice(Driver $driver, int $amountMinor): void
{
    DriverLedgerEntry::create([
        'driver_id' => $driver->getKey(),
        'kind' => LedgerEntryKind::CASH_COLLECTED,
        'amount_minor' => -$amountMinor,
        'currency' => 'UGX',
        'description' => 'Cash taken',
    ]);
}

// -- Raising --------------------------------------------------------------

it('records a remittance a driver says they have paid', function () {
    [$user, $driver] = settlementDriver();

    $data = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 47_000,
            'note' => 'Paid Musoke at Nakawa depot',
        ])
        ->assertStatus(201)
        ->json('data');

    expect($data['kind'])->toBe('remittance');
    expect($data['status'])->toBe('pending');
    expect($data['amount_minor'])->toBe(47_000);
    expect($data['note'])->toBe('Paid Musoke at Nakawa depot');
    // Nothing has been settled, so no entry exists yet.
    expect($data['ledger_entry_id'])->toBeNull();
});

it('leaves the wallet balance completely alone while a request is pending', function () {
    // **The safety property of the whole feature.** If a pending request
    // moved the balance, a driver could request their way out of what they
    // owe and the office would reconcile against a number a driver controls.
    [$user, $driver] = settlementDriver();
    oweTheOffice($driver, 47_000);

    $before = app(DriverLedgerService::class)->balanceMinor($driver);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 47_000,
        ])
        ->assertStatus(201);

    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe($before);
    expect($before)->toBe(-47_000);

    // And the driver's own stats agree — the figure they are looking at has
    // not moved either.
    $stats = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/stats')
        ->assertOk()
        ->json('data');

    expect($stats['wallet_balance_minor'])->toBe(-47_000);
});

it('stores the amount positive whichever direction it runs', function () {
    // A person typing an amount does not type a sign. The direction is
    // `kind`, so a wrong sign here cannot become a wrong sign in the ledger.
    [$user] = settlementDriver();

    $data = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::PAYOUT->value,
            'amount_minor' => 20_000,
        ])
        ->assertStatus(201)
        ->json('data');

    expect($data['amount_minor'])->toBe(20_000);
    expect($data['kind'])->toBe('payout');
});

it('refuses a second open request of the same kind', function () {
    [$user] = settlementDriver();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::PAYOUT->value,
            'amount_minor' => 20_000,
        ])
        ->assertStatus(201);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::PAYOUT->value,
            'amount_minor' => 5_000,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'SETTLEMENT_REQUEST_ALREADY_OPEN');
});

it('allows one of each kind at once, which are different conversations', function () {
    [$user] = settlementDriver();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::PAYOUT->value,
            'amount_minor' => 20_000,
        ])
        ->assertStatus(201);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 9_000,
        ])
        ->assertStatus(201);
});

it('refuses a request to settle nothing', function () {
    // An empty row in the office's queue that nobody can action or dismiss.
    [$user] = settlementDriver();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 0,
        ])
        ->assertStatus(422);
});

it('refuses a fractional amount, because money here is an integer', function () {
    [$user] = settlementDriver();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 4700.5,
        ])
        ->assertStatus(422);
});

it('refuses an account with no driver profile', function () {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 1_000,
        ])
        ->assertStatus(403);
});

// -- Confirming -----------------------------------------------------------

it('writes one settlement entry when the office confirms a remittance', function () {
    [$user, $driver] = settlementDriver();
    oweTheOffice($driver, 47_000);

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 47_000,
            'note' => 'Paid Musoke at Nakawa depot',
        ])
        ->json('data.id');

    $data = $this->actingAs(settlementStaff(), 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertOk()
        ->json('data');

    expect($data['status'])->toBe('confirmed');
    expect($data['ledger_entry_id'])->not->toBeNull();

    $entry = DriverLedgerEntry::query()->findOrFail($data['ledger_entry_id']);

    // **Positive**: a remittance reduces what the driver owes.
    expect($entry->amount_minor)->toBe(47_000);
    expect($entry->kind)->toBe(LedgerEntryKind::SETTLEMENT);
    // The driver's own words are carried into the entry, which is what makes
    // it recognisable months later.
    expect($entry->description)->toContain('Paid Musoke at Nakawa depot');

    // And the balance is now square.
    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(0);
});

it('writes a negative entry when the office confirms a payout', function () {
    [$user, $driver] = settlementDriver();

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::PAYOUT->value,
            'amount_minor' => 20_000,
        ])
        ->json('data.id');

    $data = $this->actingAs(settlementStaff(), 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertOk()
        ->json('data');

    $entry = DriverLedgerEntry::query()->findOrFail($data['ledger_entry_id']);

    // Negative: the office paid them, so they now hold that money.
    expect($entry->amount_minor)->toBe(-20_000);
    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(-20_000);
});

it('pays exactly once however many times confirm is pressed', function () {
    // The double-tap. Without the lock-and-re-read inside the transaction,
    // a retried request pays a second time — and this is the one endpoint on
    // the platform where that means real money.
    [$user, $driver] = settlementDriver();
    oweTheOffice($driver, 47_000);

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 47_000,
        ])
        ->json('data.id');

    $staff = settlementStaff();

    $first = $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertOk()
        ->json('data');

    $second = $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertOk()
        ->json('data');

    // Same entry, not a second one.
    expect($second['ledger_entry_id'])->toBe($first['ledger_entry_id']);

    expect(DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->where('kind', LedgerEntryKind::SETTLEMENT->value)
        ->count())->toBe(1);

    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(0);
});

it('records who answered it and when', function () {
    // Every confirmation is auditable — this is the first surface where a
    // staff action directly changes what a driver is owed.
    [$user] = settlementDriver();
    $staff = settlementStaff();

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 5_000,
        ])
        ->json('data.id');

    $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertOk();

    $row = DriverSettlementRequest::query()->findOrFail($requestId);

    expect($row->reviewed_by_user_id)->toBe($staff->id);
    expect($row->reviewed_at)->not->toBeNull();
});

// -- Declining ------------------------------------------------------------

it('declines with a reason, and writes no ledger entry', function () {
    [$user, $driver] = settlementDriver();

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 47_000,
        ])
        ->json('data.id');

    $data = $this->actingAs(settlementStaff(), 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/decline", [
            'reason' => 'No cash was received at the depot on that date.',
        ])
        ->assertOk()
        ->json('data');

    expect($data['status'])->toBe('declined');
    expect($data['decline_reason'])->toBe('No cash was received at the depot on that date.');
    expect($data['ledger_entry_id'])->toBeNull();

    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(0);
});

it('refuses to decline without saying why', function () {
    // "The office says no" with no reason is how a driver stops using a
    // feature — and this is the first place staff can refuse a driver
    // something about their own money.
    [$user] = settlementDriver();

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 5_000,
        ])
        ->json('data.id');

    $this->actingAs(settlementStaff(), 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/decline", [])
        ->assertStatus(422);
});

it('cannot confirm something already declined', function () {
    [$user, $driver] = settlementDriver();

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 47_000,
        ])
        ->json('data.id');

    $staff = settlementStaff();

    $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/decline", ['reason' => 'Not received.'])
        ->assertOk();

    $data = $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertOk()
        ->json('data');

    // Still declined, and no money moved.
    expect($data['status'])->toBe('declined');
    expect($data['ledger_entry_id'])->toBeNull();
    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(0);
});

// -- Who may answer -------------------------------------------------------

it('never lets a driver confirm their own request', function () {
    // Without this the whole feature is a self-service withdrawal, and the
    // balance becomes a number the person it bills controls.
    [$user, $driver] = settlementDriver();

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::PAYOUT->value,
            'amount_minor' => 500_000,
        ])
        ->json('data.id');

    $this->actingAs($user, 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertStatus(403);

    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(0);
});

it('never shows one driver another driver’s requests', function () {
    [$user] = settlementDriver();
    [$otherUser] = settlementDriver();

    $this->actingAs($otherUser, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::PAYOUT->value,
            'amount_minor' => 99_000,
        ])
        ->assertStatus(201);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/settlement-requests')
        ->assertOk()
        ->json('data');

    expect($rows)->toBe([]);
});

// -- The office queue -----------------------------------------------------

it('queues the longest-waiting request first', function () {
    // Oldest first, unlike every other list here. A driver who has waited
    // three days belongs at the top; newest-first starves them.
    [$firstUser] = settlementDriver();
    [$secondUser] = settlementDriver();

    $older = $this->actingAs($firstUser, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 1_000,
        ])
        ->json('data.id');

    $newer = $this->actingAs($secondUser, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 2_000,
        ])
        ->json('data.id');

    $rows = $this->actingAs(settlementStaff(), 'sanctum')
        ->getJson('/api/v1/settlement-requests')
        ->assertOk()
        ->json('data');

    expect(collect($rows)->pluck('id')->all())->toBe([$older, $newer]);
});

it('shows only what is still waiting, unless asked otherwise', function () {
    [$user] = settlementDriver();
    $staff = settlementStaff();

    $requestId = $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => SettlementRequestKind::REMITTANCE->value,
            'amount_minor' => 5_000,
        ])
        ->json('data.id');

    $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/settlement-requests/{$requestId}/confirm")
        ->assertOk();

    expect($this->actingAs($staff, 'sanctum')
        ->getJson('/api/v1/settlement-requests')
        ->assertOk()
        ->json('data'))->toBe([]);

    expect($this->actingAs($staff, 'sanctum')
        ->getJson('/api/v1/settlement-requests?status='.SettlementRequestStatus::CONFIRMED->value)
        ->assertOk()
        ->json('data'))->toHaveCount(1);
});

it('refuses the office queue to somebody without drivers.manage', function () {
    [$user] = settlementDriver();

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/settlement-requests')
        ->assertStatus(403);
});
