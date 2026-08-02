<?php

namespace Modules\Notifications\Listeners;

use Illuminate\Support\Facades\Notification;
use Modules\Bookings\Events\BookingApproved;
use Modules\Bookings\Events\BookingRejected;
use Modules\Notifications\Notifications\BookingApprovedNotification;
use Modules\Notifications\Notifications\BookingRejectedNotification;

/**
 * Tells the person who raised a booking what was decided.
 *
 * One listener for both outcomes because the recipient rule is the same and
 * it is the interesting part: the requester, not the approver. An approver
 * has just clicked the button and does not need telling; a dispatcher has
 * the dispatch board. The person waiting to find out is the one who asked.
 *
 * Not queued itself. The notifications it sends are (`KangaruNotification`
 * implements ShouldQueue), so the mail send is already off the request —
 * queueing the listener too would add a second hop for two model reads and
 * make the whole thing depend on a worker to produce even the in-app row.
 */
class SendBookingDecisionNotification
{
    public function approved(BookingApproved $event): void
    {
        $requester = $event->booking->requestedBy;

        // Nullable: `requested_by_user_id` is a foreign key to a user who
        // may since have been deactivated and removed. A booking outlives
        // its requester; a notification has nowhere to go without one.
        if ($requester === null) {
            return;
        }

        Notification::send($requester, BookingApprovedNotification::for($event->booking));
    }

    public function rejected(BookingRejected $event): void
    {
        $requester = $event->booking->requestedBy;

        if ($requester === null) {
            return;
        }

        Notification::send($requester, BookingRejectedNotification::for($event->booking));
    }
}
