<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverEarningsService;
use Modules\Fleet\Models\DriverDutySession;
use Modules\Fleet\Models\DriverShiftWindow;
use Modules\Fleet\Services\DutySessionService;
use Modules\Fleet\Services\RosterService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * Shifts, and the hours they add up to (ADR-0038).
 *
 * This figure will eventually be quoted at a driver in a conversation about
 * how much they are working, so the tests below fix the judgement calls that
 * are invisible in the answer: what closes an abandoned shift and at what
 * moment, what happens to a driver whose app has backgrounded mid-journey,
 * and what "no roster" means as against "a roster of nothing".
 */
function dutyDriver(): Driver
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    return Driver::factory()->create(['user_id' => $user->id]);
}

function dutyTrip(Driver $driver, string $status): Trip
{
    $vehicle = Vehicle::withoutGlobalScopes()->first() ?? Vehicle::factory()->create();
    $tenant = Tenant::withoutGlobalScopes()->first() ?? Tenant::factory()->create();

    return Trip::create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala Road',
        'destination' => 'Ntinda',
        'status' => $status,
    ]);
}

it('opens one shift however many times a driver signs on', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $sessions->open($driver->id, null);
    $sessions->open($driver->id, null);
    $sessions->open($driver->id, null);

    // `PUT /me/duty` promises this in as many words: a request that times out
    // and is retried must not start two shifts. Drop the open-session check in
    // `open()` and this counts three — and the driver's week triples.
    expect(DriverDutySession::query()->where('driver_id', $driver->id)->count())->toBe(1);
});

it('counts the hours between signing on and signing off', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $start = CarbonImmutable::parse('2026-08-10 06:00:00');

    $sessions->open($driver->id, null, $start);
    $sessions->close($driver->id, $start->addHours(7)->addMinutes(20));

    $seconds = $sessions->secondsIn($driver->id, $start, $start->addDay());

    expect($seconds)->toBe(7 * 3600 + 20 * 60);
});

it('clips a shift to the window rather than counting it whole', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    // A night shift running from Sunday evening into Monday morning. It
    // belongs to both weeks, in the proportion actually worked — counting it
    // whole in either would make two weeks sum to more than the time that
    // passed.
    $start = CarbonImmutable::parse('2026-08-09 22:00:00');
    $sessions->open($driver->id, null, $start);
    $sessions->close($driver->id, CarbonImmutable::parse('2026-08-10 04:00:00'));

    $monday = CarbonImmutable::parse('2026-08-10 00:00:00');

    expect($sessions->secondsIn($driver->id, $monday, $monday->addDay()))->toBe(4 * 3600);
    expect($sessions->secondsIn($driver->id, $monday->subDay(), $monday))->toBe(2 * 3600);
});

it('closes an abandoned shift at its last heartbeat, not at the sweep', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $start = CarbonImmutable::parse('2026-08-10 06:00:00');
    $sessions->open($driver->id, null, $start);
    $sessions->heartbeat($driver->id, $start->addHours(2));

    // Swept six hours after the driver was last heard from.
    $sessions->sweep($start->addHours(8), 180);

    $session = DriverDutySession::query()->where('driver_id', $driver->id)->first();

    // The whole point of the sweep. Close at "now" instead of at
    // `last_seen_at` and a phone left in a drawer reports an eight-hour day;
    // this driver was reachable for two.
    expect($session->ended_at->toDateTimeString())->toBe($start->addHours(2)->toDateTimeString());
    expect($session->ended_reason)->toBe(DriverDutySession::ENDED_BY_STALENESS);
    expect($sessions->secondsIn($driver->id, $start, $start->addDay()))->toBe(2 * 3600);
});

it('leaves a shift alone while the driver is on a trip, and refreshes it', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $start = CarbonImmutable::parse('2026-08-10 06:00:00');
    $sessions->open($driver->id, null, $start);
    $sessions->heartbeat($driver->id, $start->addMinutes(1));

    // The app has backgrounded — which is exactly what happens when the phone
    // goes in a cradle and the driver drives — so no heartbeat has arrived for
    // two hours. Without the trip exception the sweep signs them off with a
    // passenger aboard, and a two-hour journey reports as one minute online.
    dutyTrip($driver, TripStatus::TRIP_STARTED->value);

    $now = $start->addHours(2);
    $result = $sessions->sweep($now, 180);

    expect($result['closed'])->toBe(0);
    expect($result['refreshed'])->toBe(1);

    $session = DriverDutySession::query()->where('driver_id', $driver->id)->first();

    expect($session->ended_at)->toBeNull();
    // Refreshed, not merely skipped: when the trip ends the shift has to be
    // closable from a recent mark, or the whole journey is discarded by the
    // next sweep.
    expect($session->last_seen_at->toDateTimeString())->toBe($now->toDateTimeString());
});

it('sweeps a driver whose trip has finished', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $start = CarbonImmutable::parse('2026-08-10 06:00:00');
    $sessions->open($driver->id, null, $start);
    $sessions->heartbeat($driver->id, $start->addHours(1));

    // Terminal, so the exception above must not apply — otherwise a driver
    // who completed a ride and went home stays "online" forever.
    dutyTrip($driver, TripStatus::TRIP_COMPLETED->value);

    $result = $sessions->sweep($start->addHours(3), 180);

    expect($result['closed'])->toBe(1);
});

it('counts a running shift up to now', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $sessions->open($driver->id, null, CarbonImmutable::now()->subHours(3));

    $seconds = $sessions->secondsIn(
        $driver->id,
        CarbonImmutable::now()->subDay(),
        CarbonImmutable::now()->addDay(),
    );

    // Within a second of three hours. A running shift counted to its last
    // heartbeat instead would report a driver who is on duty right now as
    // having stopped a minute ago.
    expect($seconds)->toBeGreaterThan(3 * 3600 - 5);
    expect($seconds)->toBeLessThan(3 * 3600 + 5);
});

it('never stores a shift that ended before it began', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $start = CarbonImmutable::parse('2026-08-10 06:00:00');
    $sessions->open($driver->id, null, $start);

    // A clock adjustment between the two writes. Without the guard this stores
    // a negative shift and every sum downstream quietly loses the minutes,
    // with nothing looking wrong.
    $sessions->close($driver->id, $start->subHour());

    $session = DriverDutySession::query()->where('driver_id', $driver->id)->first();

    expect($session->ended_at->toDateTimeString())->toBe($start->toDateTimeString());
    expect($sessions->secondsIn($driver->id, $start->subDay(), $start->addDay()))->toBe(0);
});

it('never lets a late heartbeat move the mark backwards', function () {
    $driver = dutyDriver();
    $sessions = app(DutySessionService::class);

    $start = CarbonImmutable::parse('2026-08-10 06:00:00');
    $sessions->open($driver->id, null, $start);
    $sessions->heartbeat($driver->id, $start->addHours(2));
    // A handset catching up after a tunnel sends its backlog oldest-first.
    $sessions->heartbeat($driver->id, $start->addMinutes(5));

    $session = DriverDutySession::query()->where('driver_id', $driver->id)->first();

    expect($session->last_seen_at->toDateTimeString())->toBe($start->addHours(2)->toDateTimeString());
});

/**
 * A local-midnight boundary in the *fleet's* timezone.
 *
 * Not `CarbonImmutable::parse()`, which yields UTC here and would put every
 * boundary three hours out in Kampala — a roster question asked about "Tuesday"
 * would then be asked about Tuesday 03:00 to Wednesday 03:00, and a night
 * shift's tail would come back three hours short. The first draft of these
 * tests did exactly that and the arithmetic looked plausible.
 *
 * Real callers pass fleet-local boundaries already: `DriverPerformanceService`
 * takes its week from `WeeklyBonusService::currentWeek()`, which resolves the
 * same timezone.
 */
function fleetMoment(string $local): CarbonImmutable
{
    return CarbonImmutable::parse($local, app(DriverEarningsService::class)->timezone());
}

it('answers null rostered hours for a driver with no roster', function () {
    $driver = dutyDriver();

    // ADR-0017 §3: no rows means available at any hour, which is not a number.
    // Return 0 here and the Performance screen divides by it.
    expect(app(RosterService::class)->secondsIn(
        $driver->id,
        fleetMoment('2026-08-10 00:00:00'),
        fleetMoment('2026-08-17 00:00:00'),
    ))->toBeNull();
});

it('adds up a roster across a week', function () {
    $driver = dutyDriver();

    // Monday and Tuesday, 06:00–18:00. Twelve hours each.
    DriverShiftWindow::create([
        'driver_id' => $driver->id, 'weekday' => 1, 'starts_at' => '06:00:00', 'ends_at' => '18:00:00',
    ]);
    DriverShiftWindow::create([
        'driver_id' => $driver->id, 'weekday' => 2, 'starts_at' => '06:00:00', 'ends_at' => '18:00:00',
    ]);

    $seconds = app(RosterService::class)->secondsIn(
        $driver->id,
        fleetMoment('2026-08-10 00:00:00'),
        fleetMoment('2026-08-17 00:00:00'),
    );

    expect($seconds)->toBe(24 * 3600);
});

it('counts a night shift as twelve hours, not as minus twelve', function () {
    $driver = dutyDriver();

    // 18:00 → 06:00 on Monday. It does not describe an empty set; it describes
    // a night shift, and it lands six hours on Monday and six on Tuesday.
    DriverShiftWindow::create([
        'driver_id' => $driver->id, 'weekday' => 1, 'starts_at' => '18:00:00', 'ends_at' => '06:00:00',
    ]);

    $roster = app(RosterService::class);

    expect($roster->secondsIn(
        $driver->id,
        fleetMoment('2026-08-10 00:00:00'),
        fleetMoment('2026-08-17 00:00:00'),
    ))->toBe(12 * 3600);

    // The tail that a day-by-day walk starting on the window's own first day
    // would silently drop.
    expect($roster->secondsIn(
        $driver->id,
        fleetMoment('2026-08-11 00:00:00'),
        fleetMoment('2026-08-12 00:00:00'),
    ))->toBe(6 * 3600);
});
