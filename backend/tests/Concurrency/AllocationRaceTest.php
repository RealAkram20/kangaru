<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0009 §4: *"A race test is mandatory — two simultaneous exclusive
 * allocations over overlapping periods, exactly one of which may win."*
 *
 * Stated that heavily for two reasons. The overlap rule cannot be expressed
 * in MySQL 8 — no exclusion constraint, no range predicate in a UNIQUE
 * index, no cross-row CHECK — so it lives in `AllocationService` behind a
 * `SELECT ... FOR UPDATE` on the vehicle row. **Because the guarantee is
 * application code rather than schema, this test is the constraint.** And
 * this project has already shipped a race test that passed vacuously, so the
 * harness below is written to fail loudly when it is not actually racing.
 *
 * Two exclusive contracts for one vehicle over the same days both
 * succeeding would mean a client who paid for a dedicated vehicle sharing it
 * — the failure that is discovered in an invoice dispute, not in a report.
 */

/**
 * Launches the given attempts simultaneously and returns their output lines.
 *
 * Named apart from `DispatchRaceTest`'s `race()`: Pest loads every test file
 * into one process, so two global helpers of the same name would collide.
 *
 * @param  array<int, array{vehicle: Vehicle, tenant: Tenant, from: string, to: string|null, exclusive: bool, user: User}>  $attempts
 * @return array<int, string>
 */
function raceAllocations(array $attempts): array
{
    $script = base_path('tests/Support/allocation_race_attempt.php');
    // Far enough ahead that both children have finished booting and are
    // spinning on the clock before either is allowed to proceed.
    $start = microtime(true) + 2.5;

    $processes = [];
    $pipes = [];

    foreach ($attempts as $index => $attempt) {
        $command = sprintf(
            '%s %s %d %d %s %s %s %d %s',
            escapeshellarg(PHP_BINARY),
            escapeshellarg($script),
            $attempt['vehicle']->id,
            $attempt['tenant']->id,
            escapeshellarg($attempt['from']),
            escapeshellarg($attempt['to'] ?? '-'),
            $attempt['exclusive'] ? '1' : '0',
            $attempt['user']->id,
            escapeshellarg((string) $start),
        );

        $processes[$index] = proc_open(
            $command,
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes[$index],
            base_path(),
            // getenv(), not $_SERVER: the latter carries `argv` as an array
            // and proc_open only accepts scalar environment values. APP_ENV
            // must be forced so the child loads .env.testing and races inside
            // the test database, never the developer's local one.
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

it('lets exactly one of two exclusive allocations win the same vehicle', function () {
    $vehicle = Vehicle::factory()->create();
    $bank = Tenant::factory()->create();
    $ngo = Tenant::factory()->create();
    $actor = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    // Two different clients, deliberately: an exclusive contract has to
    // exclude *other* clients, and racing one tenant against itself would
    // prove less.
    $verdicts = raceAllocations([
        ['vehicle' => $vehicle, 'tenant' => $bank, 'from' => '2026-09-01', 'to' => '2026-09-30', 'exclusive' => true, 'user' => $actor],
        ['vehicle' => $vehicle, 'tenant' => $ngo, 'from' => '2026-09-15', 'to' => '2026-10-15', 'exclusive' => true, 'user' => $actor],
    ]);

    $won = array_filter($verdicts, fn (string $line) => str_starts_with($line, 'WON'));
    $lost = array_filter($verdicts, fn (string $line) => str_starts_with($line, 'LOST'));

    expect($won)->toHaveCount(1, 'Expected exactly one winner, got: '.implode(' | ', $verdicts));
    expect($lost)->toHaveCount(1, 'Expected exactly one loser, got: '.implode(' | ', $verdicts));

    // The loser must have been turned away by the overlap rule, not by a
    // deadlock or an unrelated crash that happens to look like a loss.
    expect(reset($lost))->toContain('AllocationConflictException');

    // The database is the real assertion.
    expect(VehicleAllocation::allTenants()->where('vehicle_id', $vehicle->id)->count())->toBe(1);
});

/**
 * The asymmetric race, which a lock taken on the wrong row would let
 * through: one exclusive contract against one ordinary one. Only one may
 * exist afterwards, whichever arrives first — an exclusive contract cannot
 * coexist with an ordinary one, in either order.
 */
it('lets exactly one win when only one of the two is exclusive', function () {
    $vehicle = Vehicle::factory()->create();
    $bank = Tenant::factory()->create();
    $ngo = Tenant::factory()->create();
    $actor = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $verdicts = raceAllocations([
        ['vehicle' => $vehicle, 'tenant' => $bank, 'from' => '2026-09-01', 'to' => '2026-09-30', 'exclusive' => true, 'user' => $actor],
        ['vehicle' => $vehicle, 'tenant' => $ngo, 'from' => '2026-09-10', 'to' => '2026-09-20', 'exclusive' => false, 'user' => $actor],
    ]);

    expect(array_filter($verdicts, fn (string $l) => str_starts_with($l, 'WON')))
        ->toHaveCount(1, 'Expected exactly one winner, got: '.implode(' | ', $verdicts));

    expect(VehicleAllocation::allTenants()->where('vehicle_id', $vehicle->id)->count())->toBe(1);
});

/**
 * The control. Two non-exclusive contracts overlap freely by design
 * (ADR-0009 §3), so both must survive the same simultaneous start.
 *
 * Without this, a lock that simply serialised everything — or a check that
 * refused every concurrent write — would pass the two tests above while
 * quietly breaking the arrangement the ADR set out to protect.
 */
it('lets both win when neither allocation is exclusive', function () {
    $vehicle = Vehicle::factory()->create();
    $bank = Tenant::factory()->create();
    $ngo = Tenant::factory()->create();
    $actor = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $verdicts = raceAllocations([
        ['vehicle' => $vehicle, 'tenant' => $bank, 'from' => '2026-09-01', 'to' => '2026-09-30', 'exclusive' => false, 'user' => $actor],
        ['vehicle' => $vehicle, 'tenant' => $ngo, 'from' => '2026-09-10', 'to' => '2026-09-20', 'exclusive' => false, 'user' => $actor],
    ]);

    expect(array_filter($verdicts, fn (string $l) => str_starts_with($l, 'WON')))
        ->toHaveCount(2, 'Both non-exclusive contracts should stand, got: '.implode(' | ', $verdicts));

    expect(VehicleAllocation::allTenants()->where('vehicle_id', $vehicle->id)->count())->toBe(2);
});
