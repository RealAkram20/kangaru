<?php

namespace Modules\Fleet\Enums;

/**
 * What a geofence is for (ADR-0021), following PROJECT.md's list.
 */
enum ZoneKind: string
{
    /**
     * The outer boundary of everywhere the platform operates. Used to
     * refuse an order whose pickup is nowhere near Kampala — including the
     * swapped lat/lng that ADR-0020 records range validation being unable
     * to catch.
     */
    case SERVICE_AREA = 'service_area';

    /** A town or upcountry band, for zone pricing. */
    case PRICING = 'pricing';

    /** PROJECT.md's "client-specific zones" — always carries a tenant. */
    case CLIENT = 'client';

    case BRANCH = 'branch';
    case DEPOT = 'depot';

    /** Lower wins where zones overlap, which they are meant to. */
    public function defaultPriority(): int
    {
        return match ($this) {
            self::CLIENT => 10,
            self::DEPOT => 20,
            self::BRANCH => 30,
            self::PRICING => 50,
            self::SERVICE_AREA => 90,
        };
    }

    /** Only a client zone belongs to one tenant; the rest are the platform's. */
    public function requiresTenant(): bool
    {
        return $this === self::CLIENT;
    }
}
