<?php

namespace Modules\Billing\Listeners;

use Illuminate\Support\Facades\Log;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Trips\Events\TripCompleted;

/**
 * The kerb (ADR-0045 §5). At Trip Completed a walk-in trip gets a
 * provisional fare at once — the figure the driver shows and takes — because
 * the settled fare now waits for the distance resolver. See
 * `WalkInFareService::priceProvisional()` for what it prices and why it is
 * never overwritten.
 *
 * Quiet on a tariff problem, exactly as `SettleWalkInFare` is: the trip
 * still completes, the odometer evidence is kept, and an unpriced ride is a
 * visible question rather than a wrong number.
 */
class PriceProvisionalWalkInFare
{
    public function __construct(private readonly WalkInFareService $fares) {}

    public function handle(TripCompleted $event): void
    {
        if (! $event->trip->isWalkIn()) {
            return;
        }

        try {
            $this->fares->priceProvisional($event->trip);
        } catch (RateCardNotConfiguredException $e) {
            Log::warning('billing.walk_in_provisional_fare_unpriced', [
                'trip_id' => $event->trip->id,
                'reason' => $e->getMessage(),
            ]);
        }
    }
}
