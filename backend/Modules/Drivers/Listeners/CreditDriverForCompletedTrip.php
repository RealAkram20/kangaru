<?php

namespace Modules\Drivers\Listeners;

use Illuminate\Support\Facades\Log;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Trips\Events\TripCompleted;
use Throwable;

/**
 * Credits the driver their share of a finished ride (ADR-0029 §2).
 *
 * **Registered after `SettleWalkInFare`, and that order is load-bearing**:
 * the fare does not exist until that listener has priced the trip, and a
 * ledger entry raised before it would credit nothing and then never run
 * again, because the pair is idempotent per trip.
 *
 * Not queued, for the same reason pricing is not: a driver who has just
 * dropped a passenger should see what they made, and a worker that runs
 * later shows them the previous trip's number. The work is two inserts.
 *
 * Failure is logged and swallowed. Throwing would roll the completion back —
 * losing the odometer reading the whole platform is built on — to fix a
 * bookkeeping problem a reconciliation can find later. `SettleWalkInFare`
 * already behaves this way for the same reason, and an uncredited ride is
 * the same kind of visible gap: a trip with a fare and no entries is a
 * question somebody can answer. A wrong number would not be.
 */
class CreditDriverForCompletedTrip
{
    public function __construct(private readonly DriverLedgerService $ledger) {}

    public function handle(TripCompleted $event): void
    {
        try {
            // Refreshed because SettleWalkInFare wrote the fare to the
            // database on the instance it holds, not necessarily this one.
            $this->ledger->recordCompletedTrip($event->trip->refresh());
        } catch (Throwable $e) {
            Log::warning('drivers.ledger_credit_failed', [
                'trip_id' => $event->trip->id,
                'reason' => $e->getMessage(),
            ]);
        }
    }
}
