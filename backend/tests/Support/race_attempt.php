<?php

use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchService;

/**
 * One competing dispatcher, run as its own OS process.
 *
 * AGENTS.md requires a CI test that "races two assignments and asserts
 * exactly one wins". A genuine race needs genuine concurrency, and PHP in a
 * single test process cannot provide it: the loser must block on the
 * winner's row lock, which in one thread would simply deadlock the test.
 * So DispatchRaceTest launches two copies of this script.
 *
 * Both copies are given the same `start` timestamp and busy-wait until it
 * passes, so they enter the transaction within microseconds of each other
 * rather than relying on process start-up happening to line up.
 *
 * Prints exactly one line: "WON <tripId>" or "LOST <ExceptionClass>".
 *
 * Usage: php race_attempt.php <bookingId> <vehicleId> <driverId> <userId> <startMicrotime>
 */

require __DIR__.'/../../vendor/autoload.php';

/** @var Application $app */
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$bookingId, $vehicleId, $driverId, $userId, $start] = array_slice($argv, 1);

$booking = Booking::allTenants()->findOrFail((int) $bookingId);
$user = User::findOrFail((int) $userId);

// The guard's conflict query is tenant-scope-free, but Booking/Trip reads
// are not — this process never passes through IdentifyTenant, so the tenant
// is bound by hand exactly as the seeders do.
app(TenantContext::class)->set($booking->tenant_id);

while (microtime(true) < (float) $start) {
    // Spin rather than sleep: usleep granularity is coarse enough to hand
    // one process a head start big enough to serialise the two attempts.
}

try {
    $trip = app(DispatchService::class)
        ->assign($booking, (int) $vehicleId, (int) $driverId, $user);

    echo 'WON '.$trip->id."\n";
} catch (Throwable $e) {
    echo 'LOST '.$e::class."\n";
}
