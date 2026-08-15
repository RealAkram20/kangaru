<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Models\DriverWeeklyBonus;
use Modules\Drivers\Services\WeeklyBonusService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The weekly target bonus (ADR-0034 §4, §5).
 *
 * Four properties this suite exists to hold, each of which fails quietly if
 * it breaks:
 *
 * - **Off by default.** A scheme that switches itself on at deploy is an
 *   unbudgeted liability against every driver on the platform.
 * - **Never twice for one week.** A cron can fire twice; paying payroll twice
 *   is the error nobody notices until reconciliation.
 * - **The week is the fleet's week**, not UTC's. A Kampala week measured in
 *   UTC starts on Sunday at 03:00, so two evenings land in the wrong one.
 * - **Only a closed week.** A partial week cannot be measured against a
 *   weekly target.
 */
function bonusDriver(): Driver
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    return Driver::factory()->create(['user_id' => $user->id]);
}

/** `$count` trips completed at a given instant. */
function bonusTrips(Driver $driver, int $count, string $completedAt): void
{
    for ($i = 0; $i < $count; $i++) {
        Trip::factory()
            ->forCustomer(Customer::factory()->create())
            ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
            ->forDriver($driver)
            ->create(['status' => TripStatus::TRIP_COMPLETED, 'completed_at' => $completedAt]);
    }
}

function enableBonuses(int $target = 3, int $amount = 20_000): void
{
    $settings = app(SettingsService::class);
    $settings->setGroup('billing', ['bonus_enabled' => true, 'bonus_weekly_trip_target' => $target, 'bonus_weekly_amount_minor' => $amount]);
}

/** The Monday of a week comfortably in the past, in the fleet's zone. */
function bonusWeek(): CarbonImmutable
{
    return CarbonImmutable::parse('2026-08-03', 'Africa/Kampala')->startOfDay();
}

// -- The switch ------------------------------------------------------------

it('awards nothing while the scheme is switched off, which is the default', function () {
    $driver = bonusDriver();
    bonusTrips($driver, 10, '2026-08-05T09:00:00Z');

    // No `enableBonuses()`. Configuring a target must not start a bill, the
    // same rule that defaults `maps.routing_enabled` off.
    expect(app(WeeklyBonusService::class)->awardFor(bonusWeek()))->toBe(0)
        ->and(DriverLedgerEntry::query()->count())->toBe(0);
});

// -- The rule --------------------------------------------------------------

it('credits a driver who cleared the target', function () {
    enableBonuses(target: 3, amount: 20_000);

    $driver = bonusDriver();
    bonusTrips($driver, 3, '2026-08-05T09:00:00Z');

    expect(app(WeeklyBonusService::class)->awardFor(bonusWeek()))->toBe(1);

    $entry = DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->where('kind', LedgerEntryKind::BONUS)
        ->firstOrFail();

    // **Unpaired, unlike a tip.** A bonus is not cash in anybody's hand, so
    // the balance moves by the whole amount.
    expect((int) $entry->amount_minor)->toBe(20_000)
        ->and(DriverLedgerEntry::query()->where('driver_id', $driver->getKey())->count())->toBe(1);
});

it('does not credit a driver who fell short', function () {
    enableBonuses(target: 3);

    $driver = bonusDriver();
    bonusTrips($driver, 2, '2026-08-05T09:00:00Z');

    expect(app(WeeklyBonusService::class)->awardFor(bonusWeek()))->toBe(0)
        ->and(DriverLedgerEntry::query()->count())->toBe(0);
});

it('takes no commission on a bonus', function () {
    enableBonuses(target: 1, amount: 20_000);

    $driver = bonusDriver();
    bonusTrips($driver, 1, '2026-08-05T09:00:00Z');

    app(WeeklyBonusService::class)->awardFor(bonusWeek());

    // The advertised figure and the paid figure must not differ — that is the
    // one thing an incentive cannot do. 20% of 20,000 would be 16,000.
    expect((int) DriverLedgerEntry::query()->where('kind', LedgerEntryKind::BONUS)->value('amount_minor'))
        ->toBe(20_000);
});

it('freezes the target and the amount in the entry, because both are settable', function () {
    enableBonuses(target: 3, amount: 20_000);

    $driver = bonusDriver();
    bonusTrips($driver, 5, '2026-08-05T09:00:00Z');

    app(WeeklyBonusService::class)->awardFor(bonusWeek());

    $description = (string) DriverLedgerEntry::query()
        ->where('kind', LedgerEntryKind::BONUS)
        ->value('description');

    // An award explained only by "the current target" is one nobody can
    // defend a year later — ADR-0029 §3's rule for a second kind of rate.
    expect($description)->toContain('5 trips')->toContain('target of 3');
});

// -- Paying once -----------------------------------------------------------

it('never pays a week twice, however often the command runs', function () {
    enableBonuses(target: 2);

    $driver = bonusDriver();
    bonusTrips($driver, 4, '2026-08-05T09:00:00Z');

    $service = app(WeeklyBonusService::class);

    expect($service->awardFor(bonusWeek()))->toBe(1)
        // The second run is a no-op, and it is the unique index on
        // `(driver_id, week_start)` that makes it one rather than a
        // pre-flight check that could race.
        ->and($service->awardFor(bonusWeek()))->toBe(0)
        ->and($service->awardFor(bonusWeek()))->toBe(0);

    expect(DriverLedgerEntry::query()->where('kind', LedgerEntryKind::BONUS)->count())->toBe(1)
        ->and(DriverWeeklyBonus::query()->count())->toBe(1);
});

it('awards a second week to the same driver', function () {
    enableBonuses(target: 2);

    $driver = bonusDriver();
    bonusTrips($driver, 2, '2026-08-05T09:00:00Z');
    bonusTrips($driver, 2, '2026-08-12T09:00:00Z');

    $service = app(WeeklyBonusService::class);

    // The guard is per week, not per driver — a driver who keeps clearing the
    // target keeps earning it.
    expect($service->awardFor(bonusWeek()))->toBe(1)
        ->and($service->awardFor(bonusWeek()->addWeek()))->toBe(1);
});

// -- Which week ------------------------------------------------------------

it('counts a trip into the fleet’s week, not UTC’s', function () {
    enableBonuses(target: 1);

    $driver = bonusDriver();

    // 22:30 UTC on Sunday 9 August is 01:30 on Monday 10 August in Kampala.
    // A UTC week boundary files it under the week of the 3rd; the fleet's
    // files it under the week of the 10th, which is when the driver drove it.
    bonusTrips($driver, 1, '2026-08-09T22:30:00Z');

    $service = app(WeeklyBonusService::class);

    expect($service->awardFor(bonusWeek()))->toBe(0)
        ->and($service->awardFor(bonusWeek()->addWeek()))->toBe(1);
});

it('names the week that has just closed, never the one in progress', function () {
    $service = app(WeeklyBonusService::class);

    $at = CarbonImmutable::parse('2026-08-12T09:00:00', 'Africa/Kampala');
    $week = $service->lastClosedWeek($at);

    // The 12th is a Wednesday. The week in progress began on Monday the 10th;
    // the closed one began on the 3rd. A partial week cannot be measured
    // against a weekly target, and a bonus that un-awards itself is a lie.
    expect($week->toDateString())->toBe('2026-08-03');
});

// -- Reaching the driver ---------------------------------------------------

it('shows up as earnings, in a row of its own', function () {
    enableBonuses(target: 1, amount: 20_000);

    $driver = bonusDriver();
    /** @var User $user */
    $user = $driver->user()->firstOrFail();

    // Inside today's window so `/me/earnings?period=day` sees it.
    bonusTrips($driver, 1, now()->toIso8601String());
    app(WeeklyBonusService::class)->awardFor(
        CarbonImmutable::now('Africa/Kampala')->startOfWeek()->startOfDay(),
    );

    $earnings = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    $bonuses = collect($earnings['breakdown'])->firstWhere('service_type', 'bonus');

    // A row of its own, not `other`. A bonus has no trip, so without the
    // kind-first grouping it would be filed as unclassifiable work.
    expect($bonuses)->not->toBeNull()
        ->and($bonuses['earned_minor'])->toBe(20_000);
});

it('is refused to a driver of somebody else’s trips', function () {
    enableBonuses(target: 2);

    $earner = bonusDriver();
    $other = bonusDriver();

    bonusTrips($earner, 4, '2026-08-05T09:00:00Z');
    bonusTrips($other, 1, '2026-08-05T09:00:00Z');

    app(WeeklyBonusService::class)->awardFor(bonusWeek());

    expect(DriverWeeklyBonus::query()->where('driver_id', $other->getKey())->count())->toBe(0)
        ->and(DriverWeeklyBonus::query()->where('driver_id', $earner->getKey())->count())->toBe(1);
});
