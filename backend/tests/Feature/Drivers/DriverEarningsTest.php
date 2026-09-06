<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Illuminate\Support\Carbon;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /me/earnings` — the driver app's earnings screen.
 *
 * The screen's mockup asked for five money rows and this platform can produce
 * two of them. What is asserted here is mostly the seams where that goes
 * wrong quietly:
 *
 * - **The breakdown must reconcile with the total.** It is built as folds over
 *   one un-joined row set precisely so it cannot drift, and the sum is pinned
 *   here because it is the defect a driver would actually notice.
 * - **A trip with no order request must still be counted.** It cannot be
 *   classified as a ride or a delivery, and dropping it would lose real money
 *   out of a breakdown that still displayed a correct total above it.
 * - **The day boundary is the driver's, not UTC.** `config/app.php` is UTC, so
 *   an unconverted `startOfDay()` rolls a Kampala driver's day at 03:00 local.
 * - **The trend is continuous.** A chart that omits empty hours draws 3 AM
 *   beside 7 PM.
 * - **No tips, no bonuses, no online hours** — none of the three exists.
 *
 * Times are chosen against `Africa/Kampala` (UTC+3, no DST), which is the
 * default `settings.regional.timezone`.
 */
function earningsDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

/**
 * A completed trip that credited the driver, optionally with an order request
 * behind it so it can be classified.
 *
 * Ledger rows are written directly here rather than through
 * `DriverLedgerService`, and deliberately: this suite is about *reading* a
 * period, so it needs entries at controlled instants, and
 * `recordCompletedTrip()` always stamps `now()`. The service's own arithmetic
 * is covered by `DriverLedgerTest` and `TripEarningsTest`.
 */
function earningsTripAt(
    Driver $driver,
    string $completedAtUtc,
    int $earnedMinor,
    ?OrderRequestServiceType $serviceType = OrderRequestServiceType::RIDE,
    ?int $minutes = 30,
): Trip {
    $customer = Customer::factory()->create();

    $completedAt = Carbon::parse($completedAtUtc, 'UTC');

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'status' => TripStatus::TRIP_COMPLETED,
            'fare_minor' => $earnedMinor + 2_000,
            'fare_currency' => 'UGX',
            'fare_computed_at' => $completedAt,
            'started_at' => $minutes === null ? null : $completedAt->copy()->subMinutes($minutes),
            'completed_at' => $completedAt,
        ]);

    if ($serviceType !== null) {
        OrderRequest::factory()->create([
            'customer_id' => $customer->id,
            'trip_id' => $trip->id,
            'service_type' => $serviceType,
            'scheduled_for' => null,
        ]);
    }

    DriverLedgerEntry::create([
        'driver_id' => $driver->getKey(),
        'trip_id' => $trip->id,
        'kind' => LedgerEntryKind::FARE_EARNED,
        'amount_minor' => $earnedMinor,
        'currency' => 'UGX',
        'description' => 'Fare',
    ]);

    // The counterpart ADR-0029 §2 writes alongside every credit. Present so
    // the suite proves earnings exclude it — summing both kinds would report
    // roughly minus the commission.
    DriverLedgerEntry::create([
        'driver_id' => $driver->getKey(),
        'trip_id' => $trip->id,
        'kind' => LedgerEntryKind::CASH_COLLECTED,
        'amount_minor' => -($earnedMinor + 2_000),
        'currency' => 'UGX',
        'description' => 'Cash taken',
    ]);

    DriverLedgerEntry::query()
        ->where('trip_id', $trip->id)
        ->update(['created_at' => $completedAt, 'updated_at' => $completedAt]);

    return $trip;
}

/** Freeze the clock at a Kampala local time, expressed in UTC. */
function atKampala(string $localTime): void
{
    Carbon::setTestNow(Carbon::parse($localTime, 'Africa/Kampala')->utc());
}

afterEach(function () {
    Carbon::setTestNow();
});

// -- The total ------------------------------------------------------------

it('totals the driver share for the day and excludes the cash-collected side', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 14:00');
    earningsTripAt($driver, '2026-08-15 07:00:00', 10_000);
    earningsTripAt($driver, '2026-08-15 09:00:00', 8_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    // 18,000 earned. The `cash_collected` rows are -12,000 and -10,000; if
    // they leaked in, this would be deeply negative.
    expect($data['total_minor'])->toBe(18_000);
    expect($data['trips'])->toBe(2);
    expect($data['currency'])->toBe('UGX');
    expect($data['period'])->toBe('day');
});

it('defaults to the day when no period is given', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 14:00');
    earningsTripAt($driver, '2026-08-15 07:00:00', 10_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings')
        ->assertOk()
        ->json('data');

    expect($data['period'])->toBe('day');
    expect($data['total_minor'])->toBe(10_000);
});

it('refuses a period it does not know rather than quietly falling back', function () {
    [$user] = earningsDriver();

    atKampala('2026-08-15 14:00');

    // AGENTS.md: an unknown filter returns 422, not silence. Without the form
    // request, `EarningsPeriod::from()` would throw a ValueError and surface
    // as a 500.
    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=fortnight')
        ->assertStatus(422);
});

it('refuses an account with no driver profile', function () {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    atKampala('2026-08-15 14:00');

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings')
        ->assertStatus(403);
});

// -- The day boundary -----------------------------------------------------

it("counts a late-evening trip in the driver's day, not the next UTC one", function () {
    // The bug this endpoint was built around. 23:30 Kampala on the 15th is
    // 20:30 UTC on the 15th — fine. But 01:00 Kampala on the 16th is 22:00
    // UTC on the *15th*, and a UTC startOfDay would file it under the 15th.
    [$user, $driver] = earningsDriver();

    // Now: 02:00 Kampala on the 16th. The driver is mid-shift, after
    // midnight, and their day started two hours ago.
    atKampala('2026-08-16 02:00');

    // 01:00 Kampala on the 16th == 22:00 UTC on the 15th.
    earningsTripAt($driver, '2026-08-15 22:00:00', 9_000);
    // 23:00 Kampala on the 15th == 20:00 UTC on the 15th — yesterday.
    earningsTripAt($driver, '2026-08-15 20:00:00', 5_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    // Only the 01:00 trip is today. A UTC boundary would have caught both,
    // because both are 15 August in UTC.
    expect($data['total_minor'])->toBe(9_000);
    expect($data['timezone'])->toBe('Africa/Kampala');
});

it('measures the day in whatever timezone the office has configured', function () {
    // The international-ready half: the boundary is a setting, not Kampala
    // hardcoded. In Tokyo (UTC+9) the same instant falls on a different day.
    [$user, $driver] = earningsDriver();

    app(SettingsService::class)->setGroup('regional', [
        'currency' => 'UGX',
        'timezone' => 'Asia/Tokyo',
        'date_format' => 'DD MMM YYYY',
    ]);

    // 2026-08-16 02:00 Tokyo == 2026-08-15 17:00 UTC.
    Carbon::setTestNow(Carbon::parse('2026-08-16 02:00', 'Asia/Tokyo')->utc());

    // 2026-08-16 01:00 Tokyo == 2026-08-15 16:00 UTC — today in Tokyo.
    earningsTripAt($driver, '2026-08-15 16:00:00', 7_000);
    // 2026-08-15 22:00 Tokyo == 2026-08-15 13:00 UTC — yesterday in Tokyo.
    earningsTripAt($driver, '2026-08-15 13:00:00', 4_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    expect($data['timezone'])->toBe('Asia/Tokyo');
    expect($data['total_minor'])->toBe(7_000);
});

// -- The breakdown --------------------------------------------------------

it('splits rides from deliveries and keeps unclassifiable work in its own row', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');

    earningsTripAt($driver, '2026-08-15 07:00:00', 30_000, OrderRequestServiceType::RIDE);
    earningsTripAt($driver, '2026-08-15 08:00:00', 30_000, OrderRequestServiceType::RIDE);
    earningsTripAt($driver, '2026-08-15 09:00:00', 18_000, OrderRequestServiceType::DELIVERY);
    // No order request at all — a walk-in a dispatcher fulfilled by hand.
    earningsTripAt($driver, '2026-08-15 10:00:00', 7_000, null);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    $rows = collect($data['breakdown'])->keyBy('service_type');

    expect($rows['ride']['trips'])->toBe(2);
    expect($rows['ride']['earned_minor'])->toBe(60_000);
    expect($rows['delivery']['trips'])->toBe(1);
    expect($rows['delivery']['earned_minor'])->toBe(18_000);

    // The row the mockup had nowhere to put. Without it the breakdown would
    // show 78,000 under a total of 85,000 and nothing would say why.
    expect($rows['other']['trips'])->toBe(1);
    expect($rows['other']['earned_minor'])->toBe(7_000);
});

it('always has a breakdown that adds up to the total', function () {
    // The invariant. It holds by construction — total and breakdown are folds
    // over one un-joined row set — and is pinned because a join would be the
    // obvious "simplification" and would silently inflate both figures
    // differently.
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');

    earningsTripAt($driver, '2026-08-15 07:00:00', 30_000, OrderRequestServiceType::RIDE);
    earningsTripAt($driver, '2026-08-15 09:00:00', 18_000, OrderRequestServiceType::DELIVERY);
    earningsTripAt($driver, '2026-08-15 10:00:00', 7_000, null);
    earningsTripAt($driver, '2026-08-15 11:00:00', 5_000, OrderRequestServiceType::SELF_DRIVE);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    expect(collect($data['breakdown'])->sum('earned_minor'))->toBe($data['total_minor']);
    expect(collect($data['breakdown'])->sum('trips'))->toBe($data['trips']);
});

it('serves a self-drive row rather than hiding a kind the mockup omitted', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');
    earningsTripAt($driver, '2026-08-15 11:00:00', 5_000, OrderRequestServiceType::SELF_DRIVE);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    expect(collect($data['breakdown'])->pluck('service_type')->all())->toBe(['self_drive']);
});

it('orders the breakdown by earnings so the biggest row reads first', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');
    earningsTripAt($driver, '2026-08-15 09:00:00', 4_000, OrderRequestServiceType::DELIVERY);
    earningsTripAt($driver, '2026-08-15 10:00:00', 40_000, OrderRequestServiceType::RIDE);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    expect(collect($data['breakdown'])->pluck('service_type')->all())->toBe(['ride', 'delivery']);
});

// -- The trend ------------------------------------------------------------

it('serves a continuous 24-hour series for a day, empty hours included', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');
    // 10:00 Kampala == 07:00 UTC.
    earningsTripAt($driver, '2026-08-15 07:00:00', 12_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    // Every hour of the local day, not only the ones with work in them.
    expect($data['trend'])->toHaveCount(24);
    expect($data['trend'][0]['bucket'])->toBe('2026-08-15 00:00');
    expect($data['trend'][23]['bucket'])->toBe('2026-08-15 23:00');

    $byBucket = collect($data['trend'])->keyBy('bucket');

    // Bucketed in Kampala time. In UTC this entry would land at 07:00 and the
    // chart's busiest bar would sit three hours from where the driver was.
    expect($byBucket['2026-08-15 10:00']['earned_minor'])->toBe(12_000);
    expect($byBucket['2026-08-15 07:00']['earned_minor'])->toBe(0);
});

it('serves one point per day across a week, starting Monday', function () {
    [$user, $driver] = earningsDriver();

    // Saturday 15 August 2026. The week began Monday the 10th.
    atKampala('2026-08-15 20:00');
    earningsTripAt($driver, '2026-08-11 09:00:00', 6_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=week')
        ->assertOk()
        ->json('data');

    expect($data['trend'])->toHaveCount(7);
    expect($data['trend'][0]['bucket'])->toBe('2026-08-10');
    expect(collect($data['trend'])->keyBy('bucket')['2026-08-11']['earned_minor'])->toBe(6_000);
});

it('serves one point per day across a month', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');
    earningsTripAt($driver, '2026-08-03 09:00:00', 6_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=month')
        ->assertOk()
        ->json('data');

    expect($data['trend'])->toHaveCount(31);
    expect($data['trend'][0]['bucket'])->toBe('2026-08-01');
    expect($data['total_minor'])->toBe(6_000);
});

// -- An empty period ------------------------------------------------------

it('answers a day with no work without inventing anything', function () {
    [$user] = earningsDriver();

    atKampala('2026-08-15 20:00');

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    expect($data['total_minor'])->toBe(0);
    expect($data['trips'])->toBe(0);
    expect($data['breakdown'])->toBe([]);
    // Still 24 bars, all flat — the axis is time and time happened.
    expect($data['trend'])->toHaveCount(24);
    // Null, not 0: no trip carried both timestamps, so there is no duration.
    expect($data['on_trip_minutes'])->toBeNull();
    // A zero still has to say what it is denominated in.
    expect($data['currency'])->toBe('UGX');
});

// -- Time on trips --------------------------------------------------------

it('sums time actually spent on trips, which is not online hours', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');
    earningsTripAt($driver, '2026-08-15 07:00:00', 10_000, OrderRequestServiceType::RIDE, 45);
    earningsTripAt($driver, '2026-08-15 09:00:00', 8_000, OrderRequestServiceType::RIDE, 20);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    // 65 minutes driving. The driver was signed on far longer than that, and
    // this figure does not claim otherwise — `driver_presence` keeps no
    // history, so online time cannot be known.
    expect($data['on_trip_minutes'])->toBe(65);
});

// -- What is deliberately absent ------------------------------------------

it('serves no tips, no bonuses and no online-hours figure', function () {
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-15 20:00');
    earningsTripAt($driver, '2026-08-15 07:00:00', 10_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    // None of the three exists on this platform. Asserted rather than assumed
    // because the mockup asked for all three, and a later well-meaning change
    // adding a hardcoded zero for any of them would be the exact defect
    // `docs/screen-rules.md` §1 describes.
    expect($data)->not->toHaveKey('tips_minor');
    expect($data)->not->toHaveKey('bonuses_minor');
    expect($data)->not->toHaveKey('online_minutes');
    expect($data)->not->toHaveKey('online_hours');
});

it('never counts another driver’s earnings', function () {
    [$user, $driver] = earningsDriver();
    [, $other] = earningsDriver();

    atKampala('2026-08-15 20:00');
    earningsTripAt($driver, '2026-08-15 07:00:00', 10_000);
    earningsTripAt($other, '2026-08-15 08:00:00', 99_000);

    $data = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    expect($data['total_minor'])->toBe(10_000);
});

// -- The home screen agrees with it ---------------------------------------

it('reports the same today figure that /me/stats does', function () {
    // Two surfaces, one word: "Earnings today" on the home screen and
    // "Today's earnings" here. They read different services, so a difference
    // in how each decides what "today" is would show up as two numbers under
    // one label — which is why `DriverStatsService` now takes its boundary
    // from `DriverEarningsService::timezone()`.
    [$user, $driver] = earningsDriver();

    atKampala('2026-08-16 02:00');
    earningsTripAt($driver, '2026-08-15 22:00:00', 9_000);  // 01:00 local, today
    earningsTripAt($driver, '2026-08-15 20:00:00', 5_000);  // 23:00 local, yesterday

    $earnings = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    $stats = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/stats')
        ->assertOk()
        ->json('data');

    expect($stats['earnings_today_minor'])->toBe($earnings['total_minor']);
    expect($stats['earnings_today_minor'])->toBe(9_000);
});
