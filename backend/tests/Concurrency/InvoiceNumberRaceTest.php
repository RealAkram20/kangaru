<?php

use App\Models\Tenant;
use App\Models\User;
use Modules\Billing\Models\Invoice;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * AGENTS.md Integrity: *"Invoice numbers are sequential per tenant, generated
 * inside a transaction with a locked counter row. Gaps and duplicates are
 * both audit findings for bank clients."*
 *
 * Two finance users billing two different trips at the same instant is not
 * an exotic scenario — it is a month-end run. If both read the same counter
 * value, one of two things happens, and both are findings: either two
 * invoices carry the same number, or the unique index rejects one and a
 * client's completed trip silently goes unbilled.
 *
 * The race is real: two OS processes released at the same wall-clock
 * instant, both calling InvoiceService::generateForTrip(). The loser of the
 * counter lock must wait for the winner and then take the *next* number,
 * not fail and not duplicate.
 *
 * Verified to fail without the guard: with `lockForUpdate()` removed from
 * DocumentNumberSequenceRepository::lockSeries(), both processes read
 * next_number = 1 and then race to write it back, and MySQL kills one with
 *
 *     SQLSTATE[40001] ... Deadlock found ...
 *     update `document_number_sequences` set `next_number` = 2 ...
 *
 * so this test reports one winner instead of two. If you change that
 * repository, re-run the check — a numbering test that passes without the
 * lock proves nothing.
 *
 * Note that the *second* test below still passes without the lock: it is
 * guarded by the trip row lock and the unique indexes, not by the counter.
 * It is not evidence about the counter, and should not be read as such.
 *
 * Lives in the Concurrency suite rather than Feature for the same reason
 * DispatchRaceTest does: RefreshDatabase wraps each test in an uncommitted
 * transaction that a second connection can never see.
 */

/**
 * A tenant with a default rate card and two independently completed trips,
 * all committed so the child processes can see them.
 *
 * @return array{tenant: Tenant, finance: User, trips: array<int, Trip>}
 */
function invoiceRaceFixture(): array
{
    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    // Two vehicles, because a completed trip still has to have been
    // dispatched, and TripAssignmentGuard would refuse to put one vehicle
    // on two live trips at once.
    $second = Vehicle::factory()->forTenant($tenant)->create(['category' => 'sedan']);

    $trips = [
        BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042),
        BillingFixtures::completedTrip($tenant, $dispatcher, $second, $driver, 22_000, 22_010),
    ];

    return compact('tenant', 'finance', 'trips');
}

/**
 * Launches the given invoice attempts simultaneously and returns their
 * output lines.
 *
 * @param  array<int, array{trip: Trip, user: User, key: string}>  $attempts
 * @return array<int, string>
 */
function raceInvoices(array $attempts): array
{
    $script = base_path('tests/Support/invoice_race_attempt.php');
    // Far enough ahead that both children have finished booting and are
    // spinning on the clock before either is allowed to proceed.
    $start = microtime(true) + 2.5;

    $processes = [];
    $pipes = [];

    foreach ($attempts as $index => $attempt) {
        $command = sprintf(
            '%s %s %d %d %s %s',
            escapeshellarg(PHP_BINARY),
            escapeshellarg($script),
            $attempt['trip']->id,
            $attempt['user']->id,
            escapeshellarg($attempt['key']),
            escapeshellarg((string) $start),
        );

        $processes[$index] = proc_open(
            $command,
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes[$index],
            base_path(),
            // getenv(), not $_SERVER: the latter carries `argv` as an array
            // and proc_open only accepts scalar environment values. APP_ENV
            // must be forced so the child loads .env.testing and races
            // inside the test database, never the developer's local one.
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

it('gives two simultaneous invoices consecutive numbers, with no duplicate and no gap', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'trips' => $trips] = invoiceRaceFixture();

    $verdicts = raceInvoices([
        ['trip' => $trips[0], 'user' => $finance, 'key' => 'idem-race-trip-one01'],
        ['trip' => $trips[1], 'user' => $finance, 'key' => 'idem-race-trip-two01'],
    ]);

    // Unlike the dispatch race, both attempts must SUCCEED. Nothing is
    // contended except the counter, and a finance user whose invoice fails
    // because a colleague was billing a different trip at the same moment
    // would be a bug, not a safeguard.
    $won = array_filter($verdicts, fn (string $line) => str_starts_with($line, 'WON'));
    expect($won)->toHaveCount(2, 'Expected both invoices to be issued, got: '.implode(' | ', $verdicts));

    $year = now()->format('Y');
    $numbers = array_map(fn (string $line) => substr($line, 4), $won);
    sort($numbers);

    // Consecutive from 1: a duplicate would show as two identical entries,
    // a gap as ...000001 and ...000003.
    expect($numbers)->toBe(["INV-{$year}-000001", "INV-{$year}-000002"]);

    // The database is the real assertion. Two invoices, two distinct
    // numbers, and the counter advanced exactly twice.
    $invoices = Invoice::allTenants()->where('tenant_id', $tenant->id)->get();
    expect($invoices)->toHaveCount(2);
    expect($invoices->pluck('invoice_number')->unique())->toHaveCount(2);

    expect((int) DB::table('document_number_sequences')
        ->where('tenant_id', $tenant->id)
        ->where('document_type', 'invoice')
        ->value('next_number'))->toBe(3);

    // Both trips actually moved on, so neither was left billed-but-unbilled.
    foreach ($trips as $trip) {
        expect(Trip::allTenants()->find($trip->id)->status)->toBe(TripStatus::INVOICE_GENERATED);
    }
});

it('lets exactly one of two simultaneous replays of the same key win, and never bills twice', function () {
    ['tenant' => $tenant, 'finance' => $finance, 'trips' => $trips] = invoiceRaceFixture();

    // The same trip, the same idempotency key, twice at once — a client
    // that fired a retry before the first response arrived. AGENTS.md:
    // "replays return the original result, never a duplicate."
    $verdicts = raceInvoices([
        ['trip' => $trips[0], 'user' => $finance, 'key' => 'idem-race-same-key01'],
        ['trip' => $trips[0], 'user' => $finance, 'key' => 'idem-race-same-key01'],
    ]);

    $won = array_filter($verdicts, fn (string $line) => str_starts_with($line, 'WON'));
    $year = now()->format('Y');

    // Both may legitimately return WON — the loser of the trip's row lock
    // finds the winner's committed invoice and replays it. What must never
    // happen is two different invoices, or two numbers consumed.
    expect($won)->not->toBeEmpty('Expected at least one invoice, got: '.implode(' | ', $verdicts));

    foreach ($won as $line) {
        expect(substr($line, 4))->toBe("INV-{$year}-000001");
    }

    expect(Invoice::allTenants()->where('trip_id', $trips[0]->id)->count())->toBe(1);
    expect((int) DB::table('document_number_sequences')
        ->where('tenant_id', $tenant->id)
        ->where('document_type', 'invoice')
        ->value('next_number'))->toBe(2);
});
