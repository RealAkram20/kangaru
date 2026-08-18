<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Drivers\Services\PeakHoursService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The peak-hour earnings uplift (ADR-0036).
 *
 * Five properties this suite holds, each of which fails *quietly* if it breaks
 * — which is the whole reason they are pinned rather than reasoned about:
 *
 * - **Off by default.** This one bills on every trip, not once a week.
 * - **The window is the fleet's**, not UTC's. A Kampala evening measured in UTC
 *   is a window three hours out of step with the driver it rewards.
 * - **Decided on `completed_at`, never the clock.** An outbox retry must reach
 *   the same answer as the first attempt, or a driver is paid by their signal.
 * - **A percentage of the driver's share**, never of the gross fare.
 * - **A window that wraps midnight works**, because 22:00–02:00 is a plausible
 *   peak rather than a misconfiguration.
 */
function peakDriver(): Driver
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    return Driver::factory()->create(['user_id' => $user->id]);
}

/**
 * A completed, priced trip. `$completedAt` is a UTC instant — Kampala is
 * +03:00, so `16:00Z` is 19:00 local and inside a 17:00–20:00 window.
 */
function peakTrip(Driver $driver, string $completedAt, int $fareMinor = 10_000): Trip
{
    return Trip::factory()
        ->forCustomer(Customer::factory()->create())
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'status' => TripStatus::TRIP_COMPLETED,
            'completed_at' => $completedAt,
            'fare_minor' => $fareMinor,
            'fare_currency' => 'UGX',
        ]);
}

function enablePeak(string $from = '17:00', string $until = '20:00', int $percent = 20): void
{
    app(SettingsService::class)->setGroup('billing', [
        'peak_enabled' => true,
        'peak_starts_at' => $from,
        'peak_ends_at' => $until,
        'peak_uplift_percent' => $percent,
    ]);
}

function upliftFor(Driver $driver): ?DriverLedgerEntry
{
    return DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->where('kind', LedgerEntryKind::PEAK_EARNED)
        ->first();
}

// -- The switch ------------------------------------------------------------

it('pays no uplift while the scheme is switched off, which is the default', function () {
    $driver = peakDriver();
    // 19:00 Kampala — squarely inside the default window, which is exactly
    // why the *switch* has to be the thing that decides.
    $trip = peakTrip($driver, '2026-08-12T16:00:00Z');

    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    expect(upliftFor($driver))->toBeNull()
        // The ordinary pair is still written. A scheme being off must not
        // stop a driver being paid for the trip.
        ->and(DriverLedgerEntry::query()->where('driver_id', $driver->getKey())->count())->toBe(2);
});

// -- The window ------------------------------------------------------------

it('pays the uplift on a trip completed inside the window', function () {
    enablePeak(percent: 20);

    $driver = peakDriver();
    // 10,000 fare at 20% commission leaves the driver 8,000; a 20% uplift on
    // *that* is 1,600 — not 2,000, which is what a percentage of the gross
    // would give and is the mistake this figure exists to catch.
    $trip = peakTrip($driver, '2026-08-12T16:00:00Z', fareMinor: 10_000);

    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    $entry = upliftFor($driver);

    expect($entry)->not->toBeNull()
        ->and($entry->amount_minor)->toBe(1_600)
        ->and($entry->currency)->toBe('UGX')
        // Unpaired: positive, and no negative counterpart. Nothing extra
        // reached the driver's hand.
        ->and($entry->trip_id)->toBe($trip->getKey())
        // Both dials go into the sentence, because both are admin-settable and
        // an uplift explained only by "the current peak hours" is one nobody
        // can defend a year later (ADR-0029 §3).
        ->and($entry->description)->toContain('20%')
        ->and($entry->description)->toContain('17:00');
});

it('pays nothing on a trip completed outside the window', function () {
    enablePeak();

    $driver = peakDriver();
    // 11:00 Kampala.
    $trip = peakTrip($driver, '2026-08-12T08:00:00Z');

    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    expect(upliftFor($driver))->toBeNull();
});

it('measures the window in the fleet timezone, not UTC', function () {
    enablePeak(from: '17:00', until: '20:00');

    $peak = app(PeakHoursService::class);

    // 17:00 UTC is 20:00 in Kampala — *outside* a window that ends at 20:00.
    // Read as UTC it would be the first minute of the window, so this single
    // assertion is the whole timezone bug: same instant, opposite answers.
    expect($peak->activeAt(CarbonImmutable::parse('2026-08-12T17:00:00Z')))->toBeFalse()
        // 14:00 UTC is 17:00 Kampala — the first minute, inclusive.
        ->and($peak->activeAt(CarbonImmutable::parse('2026-08-12T14:00:00Z')))->toBeTrue();
});

it('is half open at the top, so a trip at the closing minute is outside', function () {
    enablePeak(from: '17:00', until: '20:00');

    $peak = app(PeakHoursService::class);

    // 19:59 local: in. 20:00 local: out. The alternative leaves a one-minute
    // overlap between a window ending and the next beginning.
    expect($peak->activeAt(CarbonImmutable::parse('2026-08-12T16:59:00Z')))->toBeTrue()
        ->and($peak->activeAt(CarbonImmutable::parse('2026-08-12T17:00:00Z')))->toBeFalse();
});

it('handles a window that wraps past midnight', function () {
    enablePeak(from: '22:00', until: '02:00');

    $peak = app(PeakHoursService::class);

    // 23:00 local, then 01:00 local — both inside a wrapping window.
    expect($peak->activeAt(CarbonImmutable::parse('2026-08-12T20:00:00Z')))->toBeTrue()
        ->and($peak->activeAt(CarbonImmutable::parse('2026-08-12T22:00:00Z')))->toBeTrue()
        // 12:00 local, comfortably outside.
        ->and($peak->activeAt(CarbonImmutable::parse('2026-08-12T09:00:00Z')))->toBeFalse();
});

it('treats equal bounds as an empty window rather than the whole day', function () {
    enablePeak(from: '17:00', until: '17:00');

    $peak = app(PeakHoursService::class);

    // Reading this as "always" is the most expensive possible interpretation
    // of a typo: it pays the uplift on every trip on the platform.
    expect($peak->activeAt(CarbonImmutable::parse('2026-08-12T16:00:00Z')))->toBeFalse()
        ->and($peak->windowOn(CarbonImmutable::parse('2026-08-12T16:00:00Z')))->toBeNull();
});

// -- The clock -------------------------------------------------------------

it('decides on completed_at rather than on the clock, so a late retry pays the same', function () {
    enablePeak();

    $driver = peakDriver();
    // Completed at 19:00 Kampala.
    $trip = peakTrip($driver, '2026-08-12T16:00:00Z');

    // ...but written to the ledger at 23:30 Kampala, which is what an offline
    // outbox drain looks like (ADR-0023). A rule that consulted "now" would
    // silently pay this driver nothing, and nothing anywhere would say why.
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-08-12T20:30:00Z'));

    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    CarbonImmutable::setTestNow();

    expect(upliftFor($driver))->not->toBeNull();
});

it('pays nothing on a trip with no completed_at', function () {
    enablePeak();

    $driver = peakDriver();
    $trip = peakTrip($driver, '2026-08-12T16:00:00Z');
    $trip->forceFill(['completed_at' => null])->save();

    app(DriverLedgerService::class)->recordCompletedTrip($trip->refresh());

    // The platform does not know when it finished, and screen-rules §1's
    // refusal to invent a value covers a timestamp the money turns on.
    expect(upliftFor($driver))->toBeNull();
});

// -- Arithmetic ------------------------------------------------------------

it('floors the uplift, so the fraction of a shilling lands with the driver', function () {
    enablePeak(percent: 20);

    $peak = app(PeakHoursService::class);

    // 8,001 * 20 / 100 = 1600.2 → 1,600.
    expect($peak->upliftMinorFor(8_001))->toBe(1_600)
        ->and($peak->upliftMinorFor(0))->toBe(0)
        // A negative share cannot happen, and if it did an "uplift" on it
        // would be a debit dressed as a reward.
        ->and($peak->upliftMinorFor(-5_000))->toBe(0);
});

it('writes no row when the uplift floors to nothing', function () {
    enablePeak(percent: 20);

    $driver = peakDriver();
    // A 4-shilling fare leaves a share of 4 (commission floors to 0); 20% of
    // that floors to 0. A row of zero is a line on a statement saying nothing
    // happened.
    $trip = peakTrip($driver, '2026-08-12T16:00:00Z', fareMinor: 4);

    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    expect(upliftFor($driver))->toBeNull();
});

// -- Idempotency -----------------------------------------------------------

it('pays the uplift once however many times the completion is retried', function () {
    enablePeak();

    $driver = peakDriver();
    $trip = peakTrip($driver, '2026-08-12T16:00:00Z');

    $ledger = app(DriverLedgerService::class);
    $ledger->recordCompletedTrip($trip);
    $ledger->recordCompletedTrip($trip);
    $ledger->recordCompletedTrip($trip);

    expect(DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->where('kind', LedgerEntryKind::PEAK_EARNED)
        ->count())->toBe(1);
});

// -- The window as the screen reads it -------------------------------------

it('resolves the window onto the day, and says whether it is live', function () {
    enablePeak(from: '17:00', until: '20:00');

    // 19:00 Kampala — inside.
    $window = app(PeakHoursService::class)->windowOn(CarbonImmutable::parse('2026-08-12T16:00:00Z'));

    expect($window)->not->toBeNull()
        ->and($window['active'])->toBeTrue()
        // Instants, not `HH:MM` for the app to re-interpret: the app must
        // never be handed the rule (ADR-0036 §6).
        ->and($window['starts_at'])->toContain('2026-08-12T17:00:00')
        ->and($window['ends_at'])->toContain('2026-08-12T20:00:00');
});

it('reports a wrapping window as ending on the following day', function () {
    enablePeak(from: '22:00', until: '02:00');

    $window = app(PeakHoursService::class)->windowOn(CarbonImmutable::parse('2026-08-12T09:00:00Z'));

    // Reporting 22:00–02:00 as ending before it starts would be a sentence
    // the screen cannot render honestly.
    expect($window['starts_at'])->toContain('2026-08-12T22:00:00')
        ->and($window['ends_at'])->toContain('2026-08-13T02:00:00');
});

it('draws nothing at all when the scheme is off', function () {
    // No `enablePeak()`.
    expect(app(PeakHoursService::class)->windowOn(CarbonImmutable::now()))->toBeNull();
});
