<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverReferral;
use Modules\Drivers\Services\DriverApplicationService;
use Modules\Drivers\Services\DriverPromotionService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /me/promotions` — the Promotions screen (ADR-0036 §6, ADR-0037 §6).
 *
 * The one property that governs the whole payload: **a scheme that is off
 * returns null, never a zero.** `docs/screen-rules.md` §1 refuses a zero
 * standing in for a figure that does not exist, and a Weekly Challenge card
 * reading "0 of 40 trips" on a fleet running no bonus scheme is exactly that,
 * dressed as a measurement.
 *
 * The rest is about what the app is *not* told. It never receives
 * `peak_starts_at` as a rule to interpret, only the window the server resolved
 * — the finding this codebase has now recorded four times.
 */
function promoDriver(): Driver
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    return Driver::factory()->create(['user_id' => $user->id]);
}

function promoTrips(Driver $driver, int $count, string $completedAt): void
{
    for ($i = 0; $i < $count; $i++) {
        Trip::factory()
            ->forCustomer(Customer::factory()->create())
            ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
            ->forDriver($driver)
            ->create(['status' => TripStatus::TRIP_COMPLETED, 'completed_at' => $completedAt]);
    }
}

// -- Everything off --------------------------------------------------------

it('offers nothing at all when every scheme is switched off', function () {
    $payload = app(DriverPromotionService::class)->forDriver(promoDriver());

    // Three nulls, not three zeroed cards. The app draws nothing, which is
    // honest rather than broken — see the docblock.
    expect($payload['weekly_challenge'])->toBeNull()
        ->and($payload['peak_hours'])->toBeNull()
        ->and($payload['referral'])->toBeNull()
        // The currency and zone are always served: they describe how to read
        // whatever *is* there, and an empty payload still has to say so.
        ->and($payload['currency'])->toBe('UGX')
        ->and($payload['timezone'])->toBe('Africa/Kampala');
});

// -- The weekly challenge --------------------------------------------------

it('reports progress against the open week, computed on the server', function () {
    app(SettingsService::class)->setGroup('billing', [
        'bonus_enabled' => true,
        'bonus_weekly_trip_target' => 30,
        'bonus_weekly_amount_minor' => 50_000,
    ]);

    $driver = promoDriver();
    // Wednesday 12 August 2026 is inside the week beginning Monday the 10th.
    promoTrips($driver, 18, '2026-08-12T09:00:00Z');

    $at = CarbonImmutable::parse('2026-08-12T12:00:00Z');
    $card = app(DriverPromotionService::class)->forDriver($driver, $at)['weekly_challenge'];

    expect($card['trips'])->toBe(18)
        ->and($card['trip_target'])->toBe(30)
        ->and($card['amount_minor'])->toBe(50_000)
        // Not yet earned, and the screen must not congratulate anybody. The
        // award still only ever runs over a *closed* week (ADR-0034 §4).
        ->and($card['achieved'])->toBeFalse()
        // The Monday, in the fleet's zone — a week measured in UTC starts on
        // Sunday at 03:00 local and files two evenings in the wrong one.
        ->and($card['week_start'])->toContain('2026-08-10T00:00:00+03:00')
        ->and($card['ends_at'])->toContain('2026-08-17T00:00:00+03:00');
});

it('counts only the open week, not everything the driver has ever done', function () {
    app(SettingsService::class)->setGroup('billing', [
        'bonus_enabled' => true,
        'bonus_weekly_trip_target' => 30,
        'bonus_weekly_amount_minor' => 50_000,
    ]);

    $driver = promoDriver();
    promoTrips($driver, 4, '2026-08-12T09:00:00Z');
    // The previous week. Counting these would show a driver progress they
    // cannot be paid for — that week is closed and already evaluated.
    promoTrips($driver, 9, '2026-08-05T09:00:00Z');

    $card = app(DriverPromotionService::class)
        ->forDriver($driver, CarbonImmutable::parse('2026-08-12T12:00:00Z'))['weekly_challenge'];

    expect($card['trips'])->toBe(4);
});

it('says so when the target has been cleared', function () {
    app(SettingsService::class)->setGroup('billing', [
        'bonus_enabled' => true,
        'bonus_weekly_trip_target' => 3,
        'bonus_weekly_amount_minor' => 50_000,
    ]);

    $driver = promoDriver();
    promoTrips($driver, 4, '2026-08-12T09:00:00Z');

    $card = app(DriverPromotionService::class)
        ->forDriver($driver, CarbonImmutable::parse('2026-08-12T12:00:00Z'))['weekly_challenge'];

    // Cleared, but still not *paid* — the command runs when the week closes.
    // The screen's wording carries that distinction, not this flag.
    expect($card['achieved'])->toBeTrue()
        ->and($card['trips'])->toBe(4);
});

// -- Peak hours ------------------------------------------------------------

it('serves the resolved peak window and the percentage, never the rule', function () {
    app(SettingsService::class)->setGroup('billing', [
        'peak_enabled' => true,
        'peak_starts_at' => '17:00',
        'peak_ends_at' => '20:00',
        'peak_uplift_percent' => 20,
    ]);

    // 19:00 Kampala.
    $at = CarbonImmutable::parse('2026-08-12T16:00:00Z');
    $card = app(DriverPromotionService::class)->forDriver(promoDriver(), $at)['peak_hours'];

    expect($card['uplift_percent'])->toBe(20)
        ->and($card['active'])->toBeTrue()
        // Instants the server resolved. The app is never handed `17:00` plus
        // a zone name to re-derive from (ADR-0036 §6).
        ->and($card['starts_at'])->toContain('2026-08-12T17:00:00+03:00')
        ->and($card['ends_at'])->toContain('2026-08-12T20:00:00+03:00')
        // The percentage travels as a number, not as "Earn 20% more" — that
        // sentence is English, and the app owns the wording (PRODUCT.md).
        ->and($card)->not->toHaveKey('headline');
});

// -- Referrals -------------------------------------------------------------

it('mints the code on the first read of the screen and reports progress', function () {
    app(SettingsService::class)->setGroup('billing', [
        'referral_enabled' => true,
        'referral_trip_target' => 10,
        'referral_reward_amount_minor' => 10_000,
    ]);

    $driver = promoDriver();

    expect($driver->referral_code)->toBeNull();

    $card = app(DriverPromotionService::class)->forDriver($driver)['referral'];

    expect($card['code'])->toHaveLength(8)
        ->and($card['trip_target'])->toBe(10)
        ->and($card['reward_amount_minor'])->toBe(10_000)
        ->and($card['introduced'])->toBe(0)
        ->and($card['qualified'])->toBe(0)
        ->and($card['earned_minor'])->toBe(0)
        // Minted, and persisted — the next read must return the same code or
        // a driver's friend types one that no longer resolves.
        ->and($driver->refresh()->referral_code)->toBe($card['code']);
});

// -- The application path --------------------------------------------------

it('attaches a referral when the office approves an application carrying a code', function () {
    app(SettingsService::class)->setGroup('billing', [
        'referral_enabled' => true,
        'referral_trip_target' => 10,
        'referral_reward_amount_minor' => 10_000,
    ]);

    $referrer = promoDriver();
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $application = DriverApplication::create([
        'name' => 'New Rider',
        'phone' => '+256700000111',
        'email' => 'new.rider@example.test',
        'password' => bcrypt('a-very-long-password'),
        'status' => DriverApplicationStatus::PENDING,
        'referral_code' => 'ABCD2345',
        'terms_accepted_at' => now(),
    ]);

    $reviewer = User::factory()->create(['role' => UserRole::SUPER_ADMIN, 'tenant_id' => null]);

    $driver = app(DriverApplicationService::class)->approve($application, $reviewer, [
        'license_number' => 'DL-REF-0001',
        'license_expiry' => now()->addYear()->toDateString(),
    ]);

    $referral = DriverReferral::query()->firstOrFail();

    expect($referral->referrer_driver_id)->toBe($referrer->getKey())
        ->and($referral->referred_driver_id)->toBe($driver->getKey())
        // Frozen at attachment, so the referrer being issued a new code
        // tomorrow cannot restate who introduced whom.
        ->and($referral->code)->toBe('ABCD2345')
        ->and($referral->qualified_at)->toBeNull();
});

it('approves the driver anyway when the code resolves to nobody', function () {
    app(SettingsService::class)->setGroup('billing', ['referral_enabled' => true]);

    $application = DriverApplication::create([
        'name' => 'New Rider',
        'phone' => '+256700000112',
        'email' => 'other.rider@example.test',
        'password' => bcrypt('a-very-long-password'),
        'status' => DriverApplicationStatus::PENDING,
        'referral_code' => 'NOSUCH99',
        'terms_accepted_at' => now(),
    ]);

    $reviewer = User::factory()->create(['role' => UserRole::SUPER_ADMIN, 'tenant_id' => null]);

    $driver = app(DriverApplicationService::class)->approve($application, $reviewer, [
        'license_number' => 'DL-REF-0002',
        'license_expiry' => now()->addYear()->toDateString(),
    ]);

    // The reviewer is giving somebody a job. A mistyped code is not a reason
    // to refuse them one, and not a reason to interrupt the approval either.
    expect($driver->exists)->toBeTrue()
        ->and(DriverReferral::query()->count())->toBe(0);
});

it('never answers whether a referral code is real to an unauthenticated caller', function () {
    app(SettingsService::class)->setGroup('billing', ['referral_enabled' => true]);

    $referrer = promoDriver();
    $referrer->forceFill(['referral_code' => 'ABCD2345'])->save();

    $payload = [
        'name' => 'Applicant',
        'phone' => '+256700000113',
        'password' => 'a-very-long-password',
        'password_confirmation' => 'a-very-long-password',
        'terms_accepted' => true,
    ];

    // A real code and an invented one must be indistinguishable from outside.
    // A validation rule here would be a free service for discovering working
    // codes one guess at a time (ADR-0037 §2).
    $good = $this->postJson('/api/v1/driver-applications', $payload + [
        'email' => 'good@example.test',
        'referral_code' => 'ABCD2345',
    ]);

    $bad = $this->postJson('/api/v1/driver-applications', $payload + [
        'email' => 'bad@example.test',
        'referral_code' => 'NOSUCH99',
    ]);

    expect($good->status())->toBe(202)
        ->and($bad->status())->toBe(202)
        ->and($bad->json('message'))->toBe($good->json('message'));
});

// -- The endpoint ----------------------------------------------------------

it('refuses an account that is not a driver', function () {
    $user = User::factory()->create(['role' => UserRole::SUPER_ADMIN, 'tenant_id' => null]);

    $this->actingAs($user)
        ->getJson('/api/v1/me/promotions')
        ->assertStatus(403)
        ->assertJsonPath('code', 'NOT_A_DRIVER');
});

it('serves the screen to a driver-scoped token', function () {
    app(SettingsService::class)->setGroup('billing', [
        'peak_enabled' => true,
        'peak_uplift_percent' => 20,
    ]);

    $driver = promoDriver();

    // **A `driver`-scoped token**, not the unscoped console one `actingAs`
    // mints. `ClientScope` fails closed, and every other test in the suite
    // signs in without a client — which is exactly how four money endpoints
    // shipped 403 to the only app with screens for them. This assertion is
    // the only kind that can see the omission.
    $token = $driver->user->createToken('driver-app', ['driver'])->plainTextToken;

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/me/promotions')
        ->assertOk()
        ->assertJsonPath('data.peak_hours.uplift_percent', 20);
});
