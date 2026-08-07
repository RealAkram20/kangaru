<?php

namespace Modules\Billing\Pricing;

use Modules\Fleet\Models\Zone;
use Modules\Fleet\Services\ZoneResolver;
use Modules\Trips\Models\Trip;

/**
 * Which pricing zone a trip is billed in (ADR-0021, billing half).
 *
 * `ZoneResolver` answers "which zones is *this point* in". This class owns
 * the question before that one — **which point?** — because it is a
 * commercial decision rather than a geometric one, and it needs somewhere it
 * can be read, argued with and changed once.
 *
 * ## The point is the pickup
 *
 * A trip is priced where the passenger was collected, taken from the
 * booking's `origin_latitude`/`origin_longitude` (ADR-0020). Three reasons:
 *
 * 1. It is the location the client agreed to. A zone surcharge a client can
 *    see coming when they book is a price; one derived from where the
 *    journey happened to end is a surprise on an invoice.
 * 2. It is the same point dispatch ranked drivers against, so "why was this
 *    trip charged the upcountry rate" and "why was that driver sent" have
 *    one answer between them.
 * 3. It exists at booking time, which is what a future "what will this
 *    cost?" quote needs. Anything derived from the completed journey could
 *    not answer that.
 *
 * ## Null is a real answer
 *
 * Null means "price this at the category's default rate", and it is reached
 * three ways, none of them an error:
 *
 * - the trip has no booking (raised at the desk, ADR-0012's walk-in path);
 * - the booking has no coordinates (phone order, or any booking taken before
 *   ADR-0020 added the columns);
 * - the point falls in no pricing zone at all.
 *
 * Refusing to bill in any of those cases would make drawing a zone a
 * breaking change for every trip outside it. Coverage is opt-in and silence
 * is safe, exactly as ADR-0021 §5 decided for service areas.
 */
class TripZoneResolver
{
    public function __construct(private readonly ZoneResolver $zones) {}

    public function pricingZoneFor(Trip $trip): ?Zone
    {
        $booking = $trip->booking;

        if ($booking === null) {
            return null;
        }

        $latitude = $booking->origin_latitude;
        $longitude = $booking->origin_longitude;

        // Both or neither: a booking with one coordinate is a half-written
        // row, and resolving it against zero would place the pickup in the
        // Gulf of Guinea — the same class of bug ADR-0021 exists to prevent.
        if ($latitude === null || $longitude === null) {
            return null;
        }

        // The tenant scopes which zones are eligible: the platform's, plus
        // this client's own. Never another client's (ADR-0021 §4).
        return $this->zones->pricingZoneAt($latitude, $longitude, $trip->tenant_id);
    }
}
