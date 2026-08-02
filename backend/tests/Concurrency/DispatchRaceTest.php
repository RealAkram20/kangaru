<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * AGENTS.md, "Concurrency (Dispatch)": *A CI test races two assignments and
 * asserts exactly one wins.* Mandatory and non-skippable, alongside the
 * cross-tenant isolation suite.
 *
 * Two dispatchers both succeeding would mean one vehicle physically
 * committed to two overlapping trips — the failure a bank client notices in
 * the field, not in a report.
 *
 * The race is real: two OS processes, released at the same wall-clock
 * instant, both calling DispatchService::assign(). Whichever loses the row
 * lock in TripAssignmentGuard must come back with a conflict, never a
 * second trip.
 */
function raceFixture(): array
{
    $tenant = Tenant::factory()->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    $vehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create();

    return compact('tenant', 'dispatcher', 'vehicle', 'driver');
}

/**
 * Launches the given attempts simultaneously and returns their output lines.
 *
 * @param  array<int, array{booking: Booking, vehicle: Vehicle, driver: Driver, user: User}>  $attempts
 * @return array<int, string>
 */
function race(array $attempts): array
{
    $script = base_path('tests/Support/race_attempt.php');
    // Far enough ahead that both children have finished booting and are
    // spinning on the clock before either is allowed to proceed.
    $start = microtime(true) + 2.5;

    $processes = [];
    $pipes = [];

    foreach ($attempts as $index => $attempt) {
        $command = sprintf(
            '%s %s %d %d %d %d %s',
            escapeshellarg(PHP_BINARY),
            escapeshellarg($script),
            $attempt['booking']->id,
            $attempt['vehicle']->id,
            $attempt['driver']->id,
            $attempt['user']->id,
            escapeshellarg((string) $start),
        );

        $processes[$index] = proc_open(
            $command,
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes[$index],
            base_path(),
            // getenv(), not $_SERVER: the latter carries `argv` as an array
            // and proc_open only accepts scalar environment values.
            // APP_ENV must be forced so the child loads .env.testing and
            // races inside the test database, never the developer's local one.
            ['APP_ENV' => 'testing'] + getenv(),
        );
    }

    $output = [];

    foreach ($processes as $index => $process) {
        $stdout = trim((string) stream_get_contents($pipes[$index][1]));
        $stderr = trim((string) stream_get_contents($pipes[$index][2]));
        fclose($pipes[$index][1]);
        fclose($pipes[$index][2]);
        proc_close($process);

        // A child that died before reaching the try/catch would otherwise
        // read as a legitimate "LOST" and hide a broken test.
        expect($stdout)->not->toBe('', "Race process {$index} produced no verdict. stderr: {$stderr}");

        $output[$index] = $stdout;
    }

    return $output;
}

it('lets exactly one of two dispatchers win the same vehicle', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle, 'driver' => $driver] = raceFixture();

    // Two different bookings, deliberately: racing the same booking would be
    // settled by the booking's own status check and would never reach the
    // vehicle lock. This is the harder case.
    $first = Booking::factory()->forTenant($tenant)->create();
    $second = Booking::factory()->forTenant($tenant)->create();

    $verdicts = race([
        ['booking' => $first, 'vehicle' => $vehicle, 'driver' => $driver, 'user' => $dispatcher],
        ['booking' => $second, 'vehicle' => $vehicle, 'driver' => $driver, 'user' => $dispatcher],
    ]);

    $won = array_filter($verdicts, fn (string $line) => str_starts_with($line, 'WON'));
    $lost = array_filter($verdicts, fn (string $line) => str_starts_with($line, 'LOST'));

    expect($won)->toHaveCount(1, 'Expected exactly one winner, got: '.implode(' | ', $verdicts));
    expect($lost)->toHaveCount(1, 'Expected exactly one loser, got: '.implode(' | ', $verdicts));

    // The loser must have been turned away by the availability guard, not by
    // some unrelated crash that happens to look like a loss.
    expect(reset($lost))->toContain('UnavailableException');

    // The database is the real assertion: one trip on that vehicle, and the
    // losing booking untouched and still dispatchable.
    expect(Trip::allTenants()->where('vehicle_id', $vehicle->id)->count())->toBe(1);
    expect(Booking::allTenants()->where('status', BookingStatus::ASSIGNED->value)->count())->toBe(1);
    expect(Booking::allTenants()->where('status', BookingStatus::PENDING->value)->count())->toBe(1);
});

it('lets exactly one of two dispatchers win the same driver on different vehicles', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'driver' => $driver] = raceFixture();

    $vehicleA = Vehicle::factory()->create();
    $vehicleB = Vehicle::factory()->create();

    $first = Booking::factory()->forTenant($tenant)->create();
    $second = Booking::factory()->forTenant($tenant)->create();

    $verdicts = race([
        ['booking' => $first, 'vehicle' => $vehicleA, 'driver' => $driver, 'user' => $dispatcher],
        ['booking' => $second, 'vehicle' => $vehicleB, 'driver' => $driver, 'user' => $dispatcher],
    ]);

    expect(array_filter($verdicts, fn (string $l) => str_starts_with($l, 'WON')))
        ->toHaveCount(1, 'Expected exactly one winner, got: '.implode(' | ', $verdicts));

    expect(Trip::allTenants()->where('driver_id', $driver->id)->count())->toBe(1);
});
