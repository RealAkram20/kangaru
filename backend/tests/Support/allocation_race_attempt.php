<?php

use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Modules\Fleet\Services\AllocationService;

/**
 * One competing contract, run as its own OS process.
 *
 * ADR-0009 §4 makes this race mandatory. The overlap rule cannot be a schema
 * constraint on MySQL 8, so it is a service-level check under a row lock —
 * and a service-level check on a uniqueness invariant is a race unless the
 * lock actually holds. Because the guarantee lives in application code, this
 * test *is* the constraint; there is nothing else behind it.
 *
 * A genuine race needs genuine concurrency, which PHP in a single test
 * process cannot provide: the loser must block on the winner's row lock,
 * which in one thread would simply deadlock the test. So the test launches
 * two copies of this script, both spinning on the same wall-clock instant.
 *
 * Prints exactly one line: "WON <allocationId>" or "LOST <ExceptionClass>".
 *
 * Usage: php allocation_race_attempt.php <vehicleId> <tenantId> <startsOn> <endsOn|-> <exclusive:0|1> <userId> <startMicrotime>
 */

require __DIR__.'/../../vendor/autoload.php';

/** @var Application $app */
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$vehicleId, $tenantId, $startsOn, $endsOn, $exclusive, $userId, $start] = array_slice($argv, 1);

$user = User::findOrFail((int) $userId);

// This process never passes through IdentifyTenant, and TenantScope fails
// closed — the write below needs the tenant bound by hand, exactly as the
// seeders do.
app(TenantContext::class)->set((int) $tenantId);

while (microtime(true) < (float) $start) {
    // Spin rather than sleep: usleep granularity is coarse enough to hand one
    // process a head start big enough to serialise the two attempts, which
    // would make the race pass without ever having been a race.
}

try {
    $allocation = app(AllocationService::class)->agree([
        'vehicle_id' => (int) $vehicleId,
        'tenant_id' => (int) $tenantId,
        'starts_on' => $startsOn,
        'ends_on' => $endsOn === '-' ? null : $endsOn,
        'exclusive' => $exclusive === '1',
    ], $user);

    echo 'WON '.$allocation->id."\n";
} catch (Throwable $e) {
    echo 'LOST '.$e::class."\n";
}
