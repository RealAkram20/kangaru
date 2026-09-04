<?php

namespace Modules\Drivers\Listeners;

use Illuminate\Support\Facades\Log;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\ReferralService;
use Modules\Trips\Events\TripCompleted;
use Throwable;

/**
 * Pays a referral reward once the driver who was introduced has done the work
 * (ADR-0037 §4).
 *
 * **A second listener rather than a line inside
 * `CreditDriverForCompletedTrip`**, and the difference is who gets paid. That
 * listener credits the driver who drove; this one credits somebody else
 * entirely, on a rule about a different driver's cumulative history. Folding
 * them together would put two unrelated payments behind one `try`, so a
 * failure in the rarer of the two would swallow the one that happens on every
 * trip.
 *
 * **Order does not matter here**, unlike that listener's placement after
 * `SettleWalkInFare`. This reads `trips`, not a fare, and the trip is already
 * `trip_completed` by the time the event fires.
 *
 * Failure is logged and swallowed, for the reason the ledger listener gives:
 * throwing would roll the completion back — losing the odometer reading the
 * whole platform is built on — to fix a bookkeeping problem a later run can
 * find. An unpaid referral is a visible gap somebody can answer; a lost trip
 * is not.
 */
class QualifyReferralForCompletedTrip
{
    public function __construct(private readonly ReferralService $referrals) {}

    public function handle(TripCompleted $event): void
    {
        try {
            $driver = Driver::query()->find($event->trip->driver_id);

            if ($driver === null) {
                return;
            }

            $this->referrals->qualify($driver);
        } catch (Throwable $e) {
            Log::warning('drivers.referral_qualify_failed', [
                'trip_id' => $event->trip->id,
                'reason' => $e->getMessage(),
            ]);
        }
    }
}
