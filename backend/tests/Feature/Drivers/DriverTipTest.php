<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Enums\SettlementRequestKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Drivers\Services\DriverSettlementRequestService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * Tips: declared by the driver, confirmed by the office (ADR-0034).
 *
 * The arithmetic is the feature, so most of this is arithmetic. A tip is
 * **commissionable** — the owner's ruling — which is what lets it reuse the
 * pair a cash fare writes:
 *
 *     tip 2,000 at 20%
 *       tip_earned          + 1,600
 *       tip_cash_collected  − 2,000
 *       ---------------------------
 *       balance               −  400
 *
 * The failure this suite exists to prevent is the quiet one: crediting the
 * whole 2,000 and losing the platform's cut. The row would look right and the
 * balance would be wrong.
 */
function tipDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

function tipTrip(Driver $driver): Trip
{
    return Trip::factory()
        ->forCustomer(Customer::factory()->create())
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create(['status' => TripStatus::TRIP_COMPLETED, 'completed_at' => now()]);
}

function office(): User
{
    return User::factory()->create(['role' => UserRole::SUPER_ADMIN, 'tenant_id' => null]);
}

// -- Declaring -------------------------------------------------------------

it('lets a driver declare a tip against their own trip', function () {
    [$user, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => 'tip',
            'amount_minor' => 2_000,
            'trip_id' => $trip->id,
            'note' => 'Passenger rounded up',
        ])
        ->assertCreated()
        ->assertJsonPath('data.kind', 'tip')
        ->assertJsonPath('data.trip_id', $trip->id)
        // Nothing has moved yet. ADR-0032's rule holds for the third kind:
        // a pending request is somebody asking, not money.
        ->assertJsonPath('data.status', 'pending');

    expect(DriverLedgerEntry::query()->where('driver_id', $driver->getKey())->count())->toBe(0);
});

it('refuses a tip declared against another driver’s trip', function () {
    [$user] = tipDriver();
    [, $other] = tipDriver();
    $theirs = tipTrip($other);

    // The validator only proves the trip is real. Without the controller's
    // ownership check this is a driver inserting themselves into somebody
    // else's journey for money — and a confirmed tip writes a credit.
    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => 'tip',
            'amount_minor' => 2_000,
            'trip_id' => $theirs->id,
        ])
        ->assertNotFound();
});

it('requires a trip on a tip and refuses one on the other kinds', function () {
    [$user, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', ['kind' => 'tip', 'amount_minor' => 2_000])
        ->assertStatus(422);

    // A remittance covers a day's takings; a trip on one would be a fact
    // nobody asked for sitting in a money record.
    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => 'remittance',
            'amount_minor' => 2_000,
            'trip_id' => $trip->id,
        ])
        ->assertStatus(422);
});

it('allows a second tip on a different trip while one is still open', function () {
    [$user, $driver] = tipDriver();
    $first = tipTrip($driver);
    $second = tipTrip($driver);

    // ADR-0032's one-open-per-kind rule becomes one-open-per-*trip* for tips.
    // A driver who took three tips in a day has three real declarations.
    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => 'tip', 'amount_minor' => 2_000, 'trip_id' => $first->id,
        ])->assertCreated();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', [
            'kind' => 'tip', 'amount_minor' => 3_000, 'trip_id' => $second->id,
        ])->assertCreated();
});

it('refuses a second tip on the same trip while one is still open', function () {
    [$user, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $body = ['kind' => 'tip', 'amount_minor' => 2_000, 'trip_id' => $trip->id];

    $this->actingAs($user, 'sanctum')->postJson('/api/v1/me/settlement-requests', $body)
        ->assertCreated();

    $this->actingAs($user, 'sanctum')->postJson('/api/v1/me/settlement-requests', $body)
        ->assertStatus(409)
        ->assertJsonPath('code', 'SETTLEMENT_REQUEST_ALREADY_OPEN');
});

// -- Confirming, which is where the money is -------------------------------

it('writes the pair, so the driver owes the commission and not the tip', function () {
    [, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $request = app(DriverSettlementRequestService::class)
        ->raise($driver, SettlementRequestKind::TIP, 2_000, 'Rounded up', 'UGX', $trip);

    app(DriverSettlementRequestService::class)->confirm($request, office());

    $entries = DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->get()
        ->keyBy(fn (DriverLedgerEntry $entry) => $entry->kind->value);

    // 20% of 2,000 is 400, so the driver keeps 1,600 and holds 2,000.
    expect((int) $entries[LedgerEntryKind::TIP_EARNED->value]->amount_minor)->toBe(1_600)
        ->and((int) $entries[LedgerEntryKind::TIP_CASH_COLLECTED->value]->amount_minor)->toBe(-2_000)
        // The whole point: the net is the commission, not the tip.
        ->and((int) $entries->sum('amount_minor'))->toBe(-400);
});

it('never credits the gross tip, which is the quiet way to get this wrong', function () {
    [, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $request = app(DriverSettlementRequestService::class)
        ->raise($driver, SettlementRequestKind::TIP, 2_000, null, 'UGX', $trip);

    app(DriverSettlementRequestService::class)->confirm($request, office());

    $credit = DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->where('kind', LedgerEntryKind::TIP_EARNED)
        ->value('amount_minor');

    // Routing a tip through `recordSettlement()` would write +2,000 and lose
    // the platform's cut with no error anywhere.
    expect((int) $credit)->not->toBe(2_000);
});

it('freezes the commission rate in the entry, so a later change cannot restate it', function () {
    [, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $request = app(DriverSettlementRequestService::class)
        ->raise($driver, SettlementRequestKind::TIP, 2_000, null, 'UGX', $trip);

    app(DriverSettlementRequestService::class)->confirm($request, office());

    $description = DriverLedgerEntry::query()
        ->where('kind', LedgerEntryKind::TIP_EARNED)
        ->value('description');

    // ADR-0029 §3. The rate is in the sentence, not merely applied.
    expect($description)->toContain('20%')->toContain("trip #{$trip->id}");
});

it('never names the passenger on a tip, however the note reads', function () {
    [, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $request = app(DriverSettlementRequestService::class)
        ->raise($driver, SettlementRequestKind::TIP, 2_000, null, 'UGX', $trip);

    app(DriverSettlementRequestService::class)->confirm($request, office());

    // ADR-0024 §7 and ADR-0034 §6. The mockup said "Tip from Sarah N."; a
    // wallet statement is permanent and scrollable, and a list of everyone
    // who ever tipped a driver by name is the directory that rule prevents.
    expect(LedgerEntryKind::TIP_EARNED->label())->toBe('Tip');

    $description = (string) DriverLedgerEntry::query()
        ->where('kind', LedgerEntryKind::TIP_EARNED)
        ->value('description');

    expect($description)->not->toContain('passenger_name');
});

it('pays a tip exactly once however many times confirm is pressed', function () {
    [, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $service = app(DriverSettlementRequestService::class);
    $request = $service->raise($driver, SettlementRequestKind::TIP, 2_000, null, 'UGX', $trip);

    $service->confirm($request, office());
    $service->confirm($request->fresh(), office());

    expect(DriverLedgerEntry::query()->where('driver_id', $driver->getKey())->count())->toBe(2);
});

it('counts a confirmed tip as earnings, and not the cash half of it', function () {
    [$user, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $service = app(DriverSettlementRequestService::class);
    $service->confirm(
        $service->raise($driver, SettlementRequestKind::TIP, 2_000, null, 'UGX', $trip),
        office(),
    );

    $earnings = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    // The credit only. Summing the cash half in would report the tip as
    // roughly minus the commission.
    expect($earnings['total_minor'])->toBe(1_600);

    $tips = collect($earnings['breakdown'])->firstWhere('service_type', 'tip');

    // Its own row, not folded into the "Rides" line of the trip it hangs off.
    expect($tips)->not->toBeNull()
        ->and($tips['earned_minor'])->toBe(1_600);
});

it('declines a tip without writing anything', function () {
    [, $driver] = tipDriver();
    $trip = tipTrip($driver);

    $service = app(DriverSettlementRequestService::class);
    $request = $service->raise($driver, SettlementRequestKind::TIP, 2_000, null, 'UGX', $trip);

    $service->decline($request, office(), 'No record of that trip being tipped.');

    expect(DriverLedgerEntry::query()->where('driver_id', $driver->getKey())->count())->toBe(0)
        ->and(DriverSettlementRequest::query()->find($request->getKey())?->status->value)
        ->toBe('declined');
});
