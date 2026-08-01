<?php

use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Modules\Billing\Services\InvoiceService;
use Modules\Trips\Models\Trip;

/**
 * One competing finance user issuing one invoice, run as its own OS process.
 *
 * AGENTS.md Integrity: "Invoice numbers are sequential per tenant, generated
 * inside a transaction with a locked counter row. Gaps and duplicates are
 * both audit findings for bank clients."
 *
 * Proving that needs genuine concurrency. A single PHP process cannot
 * express it: the loser has to block on the winner's lock on the counter
 * row, which in one thread is just a deadlock. So InvoiceNumberRaceTest
 * launches two copies of this script, exactly as DispatchRaceTest does for
 * the vehicle lock.
 *
 * Both copies busy-wait on the same `start` timestamp so they enter the
 * transaction within microseconds of each other, rather than hoping process
 * start-up happens to line up.
 *
 * Prints exactly one line: "WON <invoiceNumber>" or "LOST <ExceptionClass>".
 *
 * Usage: php invoice_race_attempt.php <tripId> <userId> <idempotencyKey> <startMicrotime>
 */

require __DIR__.'/../../vendor/autoload.php';

/** @var Application $app */
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$tripId, $userId, $idempotencyKey, $start] = array_slice($argv, 1);

$trip = Trip::allTenants()->findOrFail((int) $tripId);
$user = User::findOrFail((int) $userId);

// This process never passes through IdentifyTenant, and TenantScope fails
// closed — without this the rate card resolves to nothing and the race
// would be decided by a RATE_CARD_NOT_CONFIGURED rather than by the lock.
app(TenantContext::class)->set($trip->tenant_id);

while (microtime(true) < (float) $start) {
    // Spin rather than sleep: usleep granularity is coarse enough to hand
    // one process a head start big enough to serialise the two attempts.
}

try {
    $invoice = app(InvoiceService::class)->generateForTrip($trip, $idempotencyKey, $user);

    echo 'WON '.$invoice->invoice_number."\n";
} catch (Throwable $e) {
    // The message rides along on the verdict line: a race that fails in CI
    // is otherwise a bare exception class with no way to tell a genuine
    // conflict from a deadlock. Newlines are stripped so one attempt is
    // still exactly one line.
    echo 'LOST '.$e::class.': '.str_replace("\n", ' ', $e->getMessage())."\n";
}
