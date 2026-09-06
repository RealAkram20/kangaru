<?php

namespace Modules\Billing\Pricing;

use App\Support\Tenancy\TenantContext;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Trips\Distance\DistancePolicySource;
use Modules\Trips\Models\Trip;

/**
 * The rate card version's answer to "which witness does this trip bill on"
 * (ADR-0045 §3), resolved exactly as `InvoiceService` and
 * `WalkInFareService` resolve the version — so the distance resolver and
 * the biller can never disagree about it.
 *
 * `RateCardResolver` reads a tenant's default card through `TenantScope`,
 * and the resolver runs on the queue with no tenant bound; so the trip's own
 * tenant is bound for the lookup and the previous binding put back
 * afterwards, whatever it was. A walk-in has no tenant and needs none — its
 * tariff is the platform's own.
 */
class RateCardDistancePolicySource implements DistancePolicySource
{
    public function __construct(
        private readonly RateCardResolver $rateCards,
        private readonly TenantContext $tenants,
    ) {}

    public function policyFor(Trip $trip): DistancePolicy
    {
        $previous = $this->tenants->get();

        try {
            if ($trip->tenant_id !== null) {
                $this->tenants->set($trip->tenant_id);
            }

            return $this->rateCards->resolveFor($trip)->distance_policy;
        } catch (RateCardNotConfiguredException) {
            return DistancePolicy::GPS_PRIMARY;
        } finally {
            $this->tenants->set($previous);
        }
    }
}
