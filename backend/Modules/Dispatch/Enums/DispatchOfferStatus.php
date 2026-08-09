<?php

namespace Modules\Dispatch\Enums;

/**
 * What became of a job offered to a driver (ADR-0024 §3).
 *
 * Deliberately small, and deliberately **not** a state machine with a
 * transition map like `TripStatus` or `BookingStatus`. Those model a journey
 * with many legal paths; this models one question asked once, which has four
 * possible endings and no way back. Giving it an `allowedTransitions()` map
 * would imply a graph where there is only a fan-out from a single node.
 */
enum DispatchOfferStatus: string
{
    /** Out with the driver, clock running. The only non-terminal case. */
    case OFFERED = 'offered';

    /** They took it. `trip_id` is set, and the trip exists. */
    case ACCEPTED = 'accepted';

    /** They said no. The search moves to the next candidate. */
    case DECLINED = 'declined';

    /**
     * `expires_at` passed with no answer.
     *
     * Distinct from `declined` on purpose, and it is not a distinction
     * without a difference: a driver who declines has seen the job and
     * judged it, while a driver who times out may have been in a tunnel, or
     * driving, or asleep. `Modules/Drivers/README.md` lists acceptance rate
     * as missing, and when somebody builds it, conflating these two would
     * mean penalising a driver for Nakasongola's mobile coverage.
     */
    case EXPIRED = 'expired';

    /**
     * Somebody else took the job first, or the desk cancelled the order.
     *
     * The offer was still live and is being closed for a reason that has
     * nothing to do with the driver holding it. Their app says the job was
     * taken rather than showing a failure, and nothing about this counts
     * against them.
     */
    case SUPERSEDED = 'superseded';

    /** Whether this offer is still capable of being answered. */
    public function isOpen(): bool
    {
        return $this === self::OFFERED;
    }

    /**
     * @return array<int, self>
     */
    public static function closedValues(): array
    {
        return [self::ACCEPTED, self::DECLINED, self::EXPIRED, self::SUPERSEDED];
    }
}
