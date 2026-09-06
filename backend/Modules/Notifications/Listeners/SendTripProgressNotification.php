<?php

namespace Modules\Notifications\Listeners;

use Illuminate\Support\Facades\Notification;
use Modules\Notifications\Notifications\TripProgressNotification;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Events\TripStatusChanged;

/**
 * Tells the person who booked a car when it was assigned, when the driver
 * arrived, and when the trip finished. Every other transition is theirs
 * not to hear about — an inbox that reports "driver en route", "passenger
 * on board", "waiting" is noise, and noise is what gets an inbox muted.
 */
class SendTripProgressNotification
{
    public function handle(TripStatusChanged $event): void
    {
        $notification = match ($event->to) {
            TripStatus::ASSIGNED => $event->from === null ? TripProgressNotification::assigned($event->trip) : null,
            TripStatus::DRIVER_ARRIVED => TripProgressNotification::driverArrived($event->trip),
            TripStatus::TRIP_COMPLETED => TripProgressNotification::completed($event->trip),
            default => null,
        };

        if ($notification === null) {
            return;
        }

        $requester = $event->trip->booking?->requestedBy;
        if ($requester === null) {
            return;
        }

        Notification::send($requester, $notification);
    }
}
