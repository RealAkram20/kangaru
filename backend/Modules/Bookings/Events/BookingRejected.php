<?php

namespace Modules\Bookings\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Modules\Bookings\Models\Booking;

/**
 * A booking was refused, with `decision_reason` recorded on it.
 *
 * Separate from BookingApproved rather than one BookingDecided carrying a
 * status: a listener that had to branch on the status would be two
 * behaviours in one class, and every future subscriber would have to
 * re-derive which case it cared about.
 *
 * Cancellation has no event. A cancelled booking is usually cancelled *by*
 * the person who raised it, and telling someone what they just did is the
 * notification fatigue AGENTS.md warns about — see the README.
 */
class BookingRejected
{
    use Dispatchable;

    public function __construct(public readonly Booking $booking) {}
}
