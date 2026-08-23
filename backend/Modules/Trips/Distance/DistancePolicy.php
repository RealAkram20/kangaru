<?php

namespace Modules\Trips\Distance;

/**
 * Which witness a contract bills on (`docs/measured-distance-plan.md` §2,
 * ADR-0045).
 *
 * A commercial term, and it will live on the rate card version — dated,
 * immutable, reversible by issuing another — when Phase 2 wires billing to
 * the resolver. Until then every resolution runs under `GPS_PRIMARY`, which
 * is what the shadow report measures: how the platform *would* grade its
 * trips if the fare were priced from the trace today.
 */
enum DistancePolicy: string
{
    /** The measured trace, with the odometer as backup inside the road's corridor. */
    case GPS_PRIMARY = 'gps_primary';

    /**
     * `GPS_PRIMARY`, then never more than the routed reference plus the
     * detour cap unless the driver declared a stop. The offer to a corporate
     * client: you never pay for a detour.
     */
    case ROUTE_CAPPED = 'route_capped';

    /**
     * The odometer, as today — still graded against the trace and the road,
     * and still held when they contradict it. For a contract that names the
     * odometer as its evidence.
     */
    case ODOMETER = 'odometer';
}
