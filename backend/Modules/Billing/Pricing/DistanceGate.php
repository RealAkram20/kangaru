<?php

namespace Modules\Billing\Pricing;

use Modules\Administration\Services\SettingsService;
use Modules\Billing\Models\RateCardVersion;
use Modules\Trips\Distance\DistanceGrade;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Trips\Models\Trip;

/**
 * Whether a trip's distance is fit to bill on (ADR-0045 §2; Phase 2 of
 * `docs/measured-distance-plan.md`).
 *
 * One place, two callers — `InvoiceService` for a corporate trip and
 * `WalkInFareService` for a cash one — so the two cannot drift into
 * disagreeing about what "held" means, exactly as they share one pricing
 * engine.
 *
 * Two refusals:
 *
 * - **Unresolved.** The version bills on the measured trace (`gps_primary`
 *   or `route_capped`) and the resolver has not answered for this trip. Under
 *   the `odometer` policy the figure is the odometer delta whether or not the
 *   resolver has run, so an unresolved trip bills as it always did.
 * - **Held.** The latest resolution is grade C — the evidence speaks against
 *   the figure — and `tracking.held_blocks_billing` is on. Or it is grade U —
 *   nothing vouches for it, nothing contradicts it — and the version bills
 *   on the measured trace, which is a contract asking to be billed on
 *   something that was not measured. Under the `odometer` policy a U trip
 *   bills as it always did (ADR-0035's principle: missing evidence is not a
 *   discrepancy). A person clearing the trip (`distance_cleared_at`) lifts
 *   either hold; the evidence row it overrules is untouched.
 *
 * Neither writes anything.
 */
class DistanceGate
{
    public function __construct(private readonly SettingsService $settings) {}

    /**
     * @throws TripDistanceUnresolvedException
     * @throws TripDistanceHeldException
     */
    public function assertBillable(Trip $trip, RateCardVersion $version): void
    {
        if ($version->distance_policy !== DistancePolicy::ODOMETER && $trip->distance_resolved_at === null) {
            throw new TripDistanceUnresolvedException($trip);
        }

        if ($trip->distance_cleared_at !== null || ! (bool) $this->settings->get('tracking', 'held_blocks_billing')) {
            return;
        }

        $grade = $trip->distance_grade;

        $held = $grade === DistanceGrade::HELD
            || ($grade === DistanceGrade::UNVERIFIED && $version->distance_policy !== DistancePolicy::ODOMETER);

        if ($held) {
            // Both arms above matched a grade, so there is one to name.
            throw new TripDistanceHeldException($trip, $grade);
        }
    }
}
