<?php

namespace Modules\Billing\Listeners;

use Illuminate\Support\Facades\Log;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Pricing\TripDistanceHeldException;
use Modules\Billing\Pricing\TripDistanceUnresolvedException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Trips\Events\TripDistanceCleared;
use Modules\Trips\Events\TripDistanceResolved;

/**
 * Prices a walk-in ride the moment it finishes (ADR-0026 §3).
 *
 * Not queued, deliberately. The driver's app completes the trip and the
 * passenger is standing at the kerb waiting to be told what to pay — a fare
 * that appears whenever a worker next runs is a fare that arrives after they
 * have gone. Pricing is arithmetic over rows already loaded; it costs a
 * query, not a network round trip, so it is well inside AGENTS.md's
 * three-second budget.
 *
 * A corporate trip is left alone: those are invoiced through
 * `InvoiceService`, on a document number series, when Finance decides to
 * issue one. Pricing them here would put a total on a trip that the invoice
 * might later disagree with, and two numbers for one journey is the dispute
 * this platform exists to avoid.
 */
class SettleWalkInFare
{
    public function __construct(private readonly WalkInFareService $fares) {}

    /**
     * On `TripDistanceResolved` and `TripDistanceCleared` (ADR-0045 §5) —
     * no longer on `TripCompleted`. The fare is settled from the resolver's
     * figure, so it cannot be settled before the resolver has one; what the
     * driver shows at the kerb in the meantime is the provisional fare
     * `PriceProvisionalWalkInFare` wrote at completion.
     */
    public function handle(TripDistanceResolved|TripDistanceCleared $event): void
    {
        if (! $event->trip->isWalkIn()) {
            return;
        }

        try {
            $this->fares->settle($event->trip->refresh());
        } catch (TripDistanceUnresolvedException|TripDistanceHeldException $e) {
            // Not yet. A held trip settles when a person clears it, and this
            // listener hears that too. The provisional fare stands in on the
            // handset until then, marked as what it is.
            Log::info('billing.walk_in_fare_deferred', [
                'trip_id' => $event->trip->id,
                'reason' => $e->getMessage(),
            ]);
        } catch (RateCardNotConfiguredException $e) {
            // Loud in the log, silent to the driver, and **the trip still
            // completes**.
            //
            // The alternative is worse in both directions: throwing would
            // roll back the completion, so a driver who has dropped their
            // passenger could not close the job because an operator had not
            // priced their vehicle category — and the odometer reading, which
            // is the evidence the whole platform is built on, would be lost
            // with it.
            //
            // The fare stays null, which is visible: `fare_minor` is what a
            // reconciliation reads, and an unpriced completed ride is a
            // question somebody can answer later. A wrong number could not
            // be.
            Log::warning('billing.walk_in_fare_unpriced', [
                'trip_id' => $event->trip->id,
                'reason' => $e->getMessage(),
            ]);
        }
    }
}
