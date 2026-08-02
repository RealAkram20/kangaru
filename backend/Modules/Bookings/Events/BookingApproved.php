<?php

namespace Modules\Bookings\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Modules\Bookings\Models\Booking;

/**
 * A booking was approved.
 *
 * The event lives in Bookings and is dispatched by Bookings, so this module
 * gains no dependency by having something react to it. Modules/Notifications
 * depends on this class, not the reverse — the same direction as
 * Reports -> Billing and Billing -> Trips: a leaf depends on a core, never
 * a core on a leaf.
 *
 * The alternative was BookingService calling a notifier directly, which
 * would have made Bookings depend on Notifications and put "who gets told"
 * inside the service that decides "what happened". They are different
 * questions with different reasons to change.
 */
class BookingApproved
{
    use Dispatchable;

    public function __construct(public readonly Booking $booking) {}
}
