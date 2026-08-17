<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Models\DriverReferral;
use Modules\Drivers\Services\ReferralService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Events\TripCompleted;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * Driver referrals (ADR-0037).
 *
 * The properties here are the ones that cost real money when they break, and
 * every one of them fails silently:
 *
 * - **Off by default**, like every other scheme on this platform.
 * - **Paid after the work, never at sign-up.** The trip target *is* the
 *   verification, not a hurdle in front of the reward.
 * - **Once per referred driver, ever**, including across two applications —
 *   which ADR-0027 §5 deliberately allows to be submitted.
 * - **Once per referral, however many completions land**, which is the guard a
 *   unique index cannot provide.
 * - **The figures are frozen**, so an office that changes the reward does not
 *   restate what somebody was already promised.
 * - **The referred driver is never named** on a permanent statement.
 */
function referralDriver(string $name = 'A Driver'): Driver
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    return Driver::factory()->create(['user_id' => $user->id, 'name' => $name]);
}

function enableReferrals(int $target = 3, int $reward = 10_000): void
{
    app(SettingsService::class)->setGroup('billing', [
        'referral_enabled' => true,
        'referral_trip_target' => $target,
        'referral_reward_amount_minor' => $reward,
    ]);
}

/** `$count` completed trips for a driver. */
function referralTrips(Driver $driver, int $count): void
{
    for ($i = 0; $i < $count; $i++) {
        Trip::factory()
            ->forCustomer(Customer::factory()->create())
            ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
            ->forDriver($driver)
            ->create([
                'status' => TripStatus::TRIP_COMPLETED,
                'completed_at' => now(),
            ]);
    }
}

function rewardFor(Driver $driver): ?DriverLedgerEntry
{
    return DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->where('kind', LedgerEntryKind::REFERRAL)
        ->first();
}

// -- The switch ------------------------------------------------------------

it('attaches nothing while the scheme is switched off, which is the default', function () {
    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');

    // No `enableReferrals()`.
    expect(app(ReferralService::class)->attach($referred, 'ABCD2345'))->toBeNull()
        ->and(DriverReferral::query()->count())->toBe(0);
});

// -- Codes -----------------------------------------------------------------

it('mints a code on first use and returns the same one afterwards', function () {
    enableReferrals();

    $driver = referralDriver();
    $referrals = app(ReferralService::class);

    $first = $referrals->codeFor($driver);
    $second = $referrals->codeFor($driver->refresh());

    expect($first)->toHaveLength(8)
        ->and($second)->toBe($first)
        // No O, 0, I, 1 or L: a code is read across a table in a depot and
        // typed by somebody who has never seen it written down.
        ->and($first)->not->toMatch('/[O0I1L]/');
});

it('accepts a code however somebody types it', function () {
    enableReferrals();

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');

    // Lowercase, with the spacing people add reading it off a screen.
    $referral = app(ReferralService::class)->attach($referred, ' abcd-2345 ');

    expect($referral)->not->toBeNull()
        // Frozen in its canonical form, not as it was typed.
        ->and($referral->code)->toBe('ABCD2345');
});

// -- Attachment ------------------------------------------------------------

it('ignores a code that resolves to nobody, rather than refusing the driver', function () {
    enableReferrals();

    $referred = referralDriver();

    // Silent. The reviewer is giving somebody a job; a mistyped code is not a
    // reason to refuse them one (ADR-0037 §2).
    expect(app(ReferralService::class)->attach($referred, 'NOSUCH99'))->toBeNull()
        ->and(DriverReferral::query()->count())->toBe(0);
});

it('refuses a self-referral', function () {
    enableReferrals();

    $driver = referralDriver();
    $code = app(ReferralService::class)->codeFor($driver);

    expect(app(ReferralService::class)->attach($driver->refresh(), $code))->toBeNull()
        ->and(DriverReferral::query()->count())->toBe(0);
});

it('introduces a driver once, ever, whoever claims them second', function () {
    enableReferrals();

    $first = referralDriver('First');
    $first->forceFill(['referral_code' => 'AAAA2222'])->save();

    $second = referralDriver('Second');
    $second->forceFill(['referral_code' => 'BBBB3333'])->save();

    $referred = referralDriver('Referred');
    $referrals = app(ReferralService::class);

    expect($referrals->attach($referred, 'AAAA2222'))->not->toBeNull()
        // ADR-0027 §5 lets a duplicate application be *submitted*; this is
        // what stops it being paid for twice.
        ->and($referrals->attach($referred, 'BBBB3333'))->toBeNull()
        ->and(DriverReferral::query()->count())->toBe(1)
        ->and(DriverReferral::query()->firstOrFail()->referrer_driver_id)->toBe($first->getKey());
});

// -- Qualification ---------------------------------------------------------

it('pays nothing until the referred driver clears the target', function () {
    enableReferrals(target: 3);

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');
    app(ReferralService::class)->attach($referred, 'ABCD2345');

    referralTrips($referred, 2);

    expect(app(ReferralService::class)->qualify($referred))->toBeFalse()
        ->and(rewardFor($referrer))->toBeNull();
});

it('pays the referrer once the target is cleared', function () {
    enableReferrals(target: 3, reward: 10_000);

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');
    app(ReferralService::class)->attach($referred, 'ABCD2345');

    referralTrips($referred, 3);

    expect(app(ReferralService::class)->qualify($referred))->toBeTrue();

    $entry = rewardFor($referrer);

    expect($entry)->not->toBeNull()
        // Uncommissioned: the advertised figure and the paid figure are the
        // same, which is the one thing an incentive must not get wrong.
        ->and($entry->amount_minor)->toBe(10_000)
        // Trip-less: the trips are the *referred* driver's, and carrying one
        // would file their journey under this driver's history.
        ->and($entry->trip_id)->toBeNull()
        // The referred driver is never named. A statement is permanent, and
        // ADR-0024 §7's principle covers a colleague as much as a passenger.
        ->and($entry->description)->not->toContain('Referred')
        ->and($entry->description)->toContain('3 trips');

    $referral = DriverReferral::query()->firstOrFail();

    expect($referral->qualified_at)->not->toBeNull()
        // Written in one transaction — a row claiming to be paid that points
        // at nothing cannot exist.
        ->and($referral->ledger_entry_id)->toBe($entry->getKey());
});

it('pays once, however many completions land afterwards', function () {
    enableReferrals(target: 2);

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');
    app(ReferralService::class)->attach($referred, 'ABCD2345');

    referralTrips($referred, 5);

    $referrals = app(ReferralService::class);
    $referrals->qualify($referred);
    $referrals->qualify($referred);
    $referrals->qualify($referred);

    // The unique index cannot help here: it stops a second *referral*, not a
    // second payment against one. The `qualified_at` lock is what does.
    expect(DriverLedgerEntry::query()
        ->where('driver_id', $referrer->getKey())
        ->where('kind', LedgerEntryKind::REFERRAL)
        ->count())->toBe(1);
});

it('counts only completed trips towards the target', function () {
    enableReferrals(target: 2);

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');
    app(ReferralService::class)->attach($referred, 'ABCD2345');

    referralTrips($referred, 1);

    // A trip in progress is work that has not happened yet. Counting it would
    // pay for a job somebody might still cancel.
    Trip::factory()
        ->forCustomer(Customer::factory()->create())
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($referred)
        ->create(['status' => TripStatus::TRIP_STARTED, 'completed_at' => null]);

    expect(app(ReferralService::class)->qualify($referred))->toBeFalse();
});

// -- Frozen figures --------------------------------------------------------

it('pays what was promised, not what the setting says today', function () {
    enableReferrals(target: 2, reward: 10_000);

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');
    app(ReferralService::class)->attach($referred, 'ABCD2345');

    // The office halves the reward after the referral was attached.
    enableReferrals(target: 2, reward: 5_000);

    referralTrips($referred, 2);
    app(ReferralService::class)->qualify($referred);

    // The figure frozen onto the row, not the current one. A referral
    // explained only by "the current reward" is one nobody can defend.
    expect(rewardFor($referrer)->amount_minor)->toBe(10_000);
});

it('sums a driver progress from the frozen amounts, never the current setting', function () {
    enableReferrals(target: 1, reward: 10_000);

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referrals = app(ReferralService::class);

    $one = referralDriver('One');
    $referrals->attach($one, 'ABCD2345');
    referralTrips($one, 1);
    $referrals->qualify($one);

    // A second, attached after the reward changed and still pending.
    enableReferrals(target: 1, reward: 25_000);
    $two = referralDriver('Two');
    $referrals->attach($two, 'ABCD2345');

    $progress = $referrals->progressFor($referrer);

    expect($progress['introduced'])->toBe(2)
        ->and($progress['qualified'])->toBe(1)
        // 10,000 — what the first one actually promised. Multiplying the
        // count by the current setting would say 25,000.
        ->and($progress['earned_minor'])->toBe(10_000);
});

// -- The listener ----------------------------------------------------------

it('qualifies a referral when the referred driver completes a trip through the app', function () {
    enableReferrals(target: 1, reward: 10_000);

    $referrer = referralDriver('Referrer');
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $referred = referralDriver('Referred');
    app(ReferralService::class)->attach($referred, 'ABCD2345');

    $trip = Trip::factory()
        ->forCustomer(Customer::factory()->create())
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($referred)
        ->create([
            'status' => TripStatus::TRIP_COMPLETED,
            'completed_at' => now(),
            'fare_minor' => 10_000,
            'fare_currency' => 'UGX',
        ]);

    // The real seam: the listener wired onto TripCompleted, not the service
    // called by hand. This is what would have been missed by testing the
    // service alone.
    event(new TripCompleted($trip));

    expect(rewardFor($referrer))->not->toBeNull();
});
