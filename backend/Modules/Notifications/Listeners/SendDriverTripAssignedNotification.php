<?php

namespace Modules\Notifications\Listeners;

use Illuminate\Support\Facades\Notification;
use Modules\Notifications\Notifications\DriverTripAssignedNotification;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Events\TripStatusChanged;

/**
 * Tells the driver when the desk assigns a corporate trip to them
 * (ADR-0064). The requester's half of the same moment is
 * SendTripProgressNotification; two listeners rather than one, because the
 * two audiences part company immediately — the requester also hears about
 * arrival and completion, the driver hears about those by living them.
 */
class SendDriverTripAssignedNotification
{
    public function handle(TripStatusChanged $event): void
    {
        // Creation into Assigned — the desk's act. `from === null` is the
        // same reading the requester's listener makes: a re-entry into
        // `assigned` (if the lifecycle ever grows one) is not a new job.
        if ($event->to !== TripStatus::ASSIGNED || $event->from !== null) {
            return;
        }

        // Booking-backed trips only. A walk-in's trip is born from the
        // driver's own accept — telling them about the job they just took
        // is the fatigue AGENTS.md warns about.
        if ($event->trip->booking === null) {
            return;
        }

        // A driver without an app account has no device and no inbox; the
        // desk reaches them the way it always has — by phone. Fourteen of
        // the twenty drivers on the demo fleet are in this position, so the
        // guard is the ordinary path, not an edge.
        $driverUser = $event->trip->driver?->user;

        if ($driverUser === null) {
            return;
        }

        // **A driver who was asked is not told (ADR-0068).**
        //
        // Since the desk's assignment rings, a booking-backed trip is
        // usually born from the driver's own Accept — and announcing "New
        // trip assigned to you" a second later is the fatigue AGENTS.md
        // warns about, in the form the walk-in guard above already refuses.
        //
        // Keyed on the offers rather than on "does this driver have an
        // account", although today those two agree: the agreement is a
        // property of the current call sites, and this class has already
        // been wrong once about what could reach it.
        if ($event->trip->booking->offers()->exists()) {
            return;
        }

        Notification::send($driverUser, DriverTripAssignedNotification::for($event->trip));
    }
}
