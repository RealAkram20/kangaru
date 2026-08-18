<?php

namespace Modules\Bookings\Enums;

/**
 * The lead tray's lifecycle (ADR-0012 §2). Deliberately small: this is what
 * a dispatcher does with a phone call, not a trip state machine.
 *
 * `CONVERTED` records that the request became real-world work. It does not
 * link to a Trip or Booking — both are tenant-owned, and walk-in fulfilment
 * is deferred to its own ADR. When that lands, this case gains a foreign
 * key rather than a new meaning.
 */
enum OrderRequestStatus: string
{
    case NEW = 'new';
    case CONTACTED = 'contacted';
    case CONVERTED = 'converted';
    case CLOSED = 'closed';

    /**
     * Same shape as TripStatus/BookingStatus: the map lives here and only
     * OrderRequestService walks it. `new → converted` is legal on purpose —
     * a dispatcher who took the whole order in one call should not have to
     * fake an intermediate state to record the truth.
     *
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::NEW => [self::CONTACTED, self::CONVERTED, self::CLOSED],
            self::CONTACTED => [self::CONVERTED, self::CLOSED],
            self::CONVERTED, self::CLOSED => [],
        };
    }
}
