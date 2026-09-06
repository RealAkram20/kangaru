<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * A driver's money (ADR-0029).
 *
 * This is the most consequential arithmetic in the app: it decides what a
 * person is owed. The tests below pin the four things that would be silently
 * wrong rather than loudly broken — double payment, a retroactive rate
 * change, rounding taken from the driver, and crediting corporate work that
 * was already invoiced to a client.
 */
function ledgerDriver(): Driver
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    return Driver::factory()->create(['user_id' => $user->id]);
}

function ledgerTrip(Driver $driver, ?int $fareMinor): Trip
{
    $vehicle = Vehicle::withoutGlobalScopes()->first() ?? Vehicle::factory()->create();
    $tenant = Tenant::withoutGlobalScopes()->first() ?? Tenant::factory()->create();

    return Trip::create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala Road',
        'destination' => 'Ntinda',
        'status' => TripStatus::TRIP_COMPLETED->value,
        'completed_at' => now(),
        'fare_minor' => $fareMinor,
        'fare_currency' => $fareMinor === null ? null : 'UGX',
    ]);
}

it('raises a fare and a commission entry as a pair, never a net figure', function () {
    $driver = ledgerDriver();

    app(DriverLedgerService::class)->recordCompletedTrip(ledgerTrip($driver, 10_000));

    $entries = DriverLedgerEntry::query()->where('driver_id', $driver->id)->get();

    // Mutation check — write only a net figure and this fails. The gross
    // cash and the driver's share are different facts and both are needed.
    expect($entries)->toHaveCount(2);
    expect($entries->firstWhere('kind', LedgerEntryKind::FARE_EARNED)->amount_minor)->toBe(8_000);
    expect($entries->firstWhere('kind', LedgerEntryKind::CASH_COLLECTED)->amount_minor)->toBe(-10_000);
});

/**
 * The arithmetic the first draft of ADR-0029 got wrong.
 *
 * A cash fare leaves the driver owing the platform its commission — they are
 * holding the passenger's money. Pairing the credit with a `commission`
 * debit instead of the gross cash produced +6,000 here, as if the platform
 * owed them money it had never received.
 */
it('leaves a cash-fare driver owing exactly the commission', function () {
    $driver = ledgerDriver();

    app(DriverLedgerService::class)->recordCompletedTrip(ledgerTrip($driver, 10_000));

    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(-2_000);
});

/**
 * Trip completion is retried by the app's offline outbox (ADR-0023). Paying a
 * driver twice for one journey is the kind of error nobody notices until
 * reconciliation.
 *
 * Mutation check — drop the `$already` guard and the second call raises a
 * second pair, doubling the balance and failing this.
 */
it('never pays a driver twice for one trip', function () {
    $driver = ledgerDriver();
    $trip = ledgerTrip($driver, 10_000);

    expect(app(DriverLedgerService::class)->recordCompletedTrip($trip))->toBeTrue();
    expect(app(DriverLedgerService::class)->recordCompletedTrip($trip))->toBeFalse();

    expect(DriverLedgerEntry::query()->where('driver_id', $driver->id)->count())->toBe(2);
    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(-2_000);
});

/**
 * ADR-0029 §3. A retroactive commission change is the kind of silent rewrite
 * an audit trail cannot distinguish from theft.
 *
 * Mutation check — compute earnings from trips and the *current* rate instead
 * of reading the ledger, and the first trip's figure moves when the rate
 * does, failing this.
 */
it('does not restate what a driver already earned when the rate changes', function () {
    $driver = ledgerDriver();
    $ledger = app(DriverLedgerService::class);

    $ledger->recordCompletedTrip(ledgerTrip($driver, 10_000));

    app(SettingsService::class)->setGroup('billing', ['driver_commission_percent' => 50]);

    $ledger->recordCompletedTrip(ledgerTrip($driver, 10_000));

    $earned = DriverLedgerEntry::query()
        ->where('driver_id', $driver->id)
        ->where('kind', LedgerEntryKind::FARE_EARNED->value)
        ->orderBy('id')
        ->pluck('amount_minor')
        ->all();

    // The first ride keeps its 20%; only the second sees 50%.
    expect($earned)->toBe([8_000, 5_000]);
});

/**
 * The house rounds against itself (ADR-0029 §3): `intdiv` floors the
 * commission, so the odd shilling lands with the driver.
 *
 * Mutation check — use `(int) round(...)` and 20% of 1,001 becomes 200,
 * leaving the driver 801 instead of 801… so use a fare where the two differ:
 * 999 at 20% is 199.8, which floors to 199 and rounds to 200.
 */
it('rounds the commission down so the odd shilling stays with the driver', function () {
    $driver = ledgerDriver();

    app(DriverLedgerService::class)->recordCompletedTrip(ledgerTrip($driver, 999));

    $entries = DriverLedgerEntry::query()->where('driver_id', $driver->id)->get();

    expect($entries->firstWhere('kind', LedgerEntryKind::FARE_EARNED)->amount_minor)->toBe(800);
    expect($entries->firstWhere('kind', LedgerEntryKind::CASH_COLLECTED)->amount_minor)->toBe(-999);
    // 999 gross, 800 earned: the commission is 199, not the 200 that rounding
    // to nearest would have taken off them.
    expect(app(DriverLedgerService::class)->balanceMinor($driver))->toBe(-199);
});

/**
 * ADR-0029 §4: a corporate trip is invoiced to the client and carries no
 * fare. Crediting one would pay the driver for money the platform never took
 * as cash, and double-bill a client who already has an invoice.
 */
it('raises nothing for a trip the platform never priced', function () {
    $driver = ledgerDriver();

    expect(app(DriverLedgerService::class)->recordCompletedTrip(ledgerTrip($driver, null)))->toBeFalse();
    expect(DriverLedgerEntry::query()->where('driver_id', $driver->id)->count())->toBe(0);
});

it('clears the debt when the driver remits the cash, and records who took it', function () {
    $driver = ledgerDriver();
    $ledger = app(DriverLedgerService::class);
    $office = User::factory()->create(['tenant_id' => null, 'role' => UserRole::OPERATIONS_MANAGER]);

    $ledger->recordCompletedTrip(ledgerTrip($driver, 10_000));
    // Positive: the rider hands the office its 2,000 share at the depot.
    $ledger->recordSettlement($driver, 2_000, $office, 'Commission remitted at the depot');

    expect($ledger->balanceMinor($driver))->toBe(0);
    expect(DriverLedgerEntry::query()->where('kind', LedgerEntryKind::SETTLEMENT->value)->sole()->created_by_user_id)
        ->toBe($office->id);
});

/**
 * A driver holding the platform's cash is legitimately negative (ADR-0029
 * §5), and the balance must say so rather than clamping at zero — that is
 * the number a settlement conversation starts from.
 */
it('goes positive when the platform genuinely owes the driver', function () {
    $driver = ledgerDriver();
    $ledger = app(DriverLedgerService::class);
    $office = User::factory()->create(['tenant_id' => null, 'role' => UserRole::OPERATIONS_MANAGER]);

    $ledger->recordCompletedTrip(ledgerTrip($driver, 10_000));
    // The rider over-remits: 5,000 handed over against a 2,000 debt.
    $ledger->recordSettlement($driver, 5_000, $office, 'Over-remitted at the depot');

    // Mutation check — clamp the balance at zero and this fails. A driver the
    // platform owes must be able to see it.
    expect($ledger->balanceMinor($driver))->toBe(3_000);
});
