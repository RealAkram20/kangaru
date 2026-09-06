<?php

namespace Modules\Notifications\Notifications;

use Modules\Notifications\Enums\NotificationType;
use Modules\Trips\Models\Trip;

/**
 * Tells the driver the desk put a corporate job on their name (ADR-0064).
 *
 * The counterpart of TripProgressNotification's `assigned`, which tells the
 * *requester* their car exists. Before this class nobody told the driver at
 * all: the trip sat in the app's Upcoming list waiting to be stumbled on,
 * which an owner watched happen with a delivery they had just dispatched.
 *
 * ## What a lock screen may carry
 *
 * The route and nothing else. ADR-0024 §7 releases the passenger's name and
 * number only after a driver accepts, and this message exists precisely
 * because the driver has not answered yet — so the body names the two ends
 * of the journey, which identify nobody, and the app is where the rest
 * lives once they take it.
 *
 * Carries the trip's id rather than the model, for the reason every
 * notification here does: a queued job reads the world as it is when it
 * runs, not as it was when the decision was made.
 */
class DriverTripAssignedNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $tripId,
        private readonly string $origin,
        private readonly string $destination,
    ) {}

    public static function for(Trip $trip): self
    {
        return new self($trip->id, $trip->origin, $trip->destination);
    }

    public function type(): NotificationType
    {
        return NotificationType::DRIVER_TRIP_ASSIGNED;
    }

    public function subject(): string
    {
        return 'New trip assigned to you';
    }

    public function body(): string
    {
        return "{$this->origin} → {$this->destination}. Open the app to accept or decline.";
    }

    /**
     * Nowhere — this is a driver-app message and `url()` is an SPA path.
     * The app routes off `context()`'s trip id when a tap handler wants it.
     */
    public function url(): ?string
    {
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'trip_id' => $this->tripId,
            'origin' => $this->origin,
            'destination' => $this->destination,
        ];
    }

    /**
     * Delivery, not content (ADR-0046 §2): a stale assignment push is worse
     * than none — a driver whose handset was in a dead zone for half a day
     * should not have their phone announce a job the desk has long since
     * re-dispatched — so the message stops being deliverable after four
     * hours. No `channelId` and no `sound`: the offer ringtone belongs to
     * the forty-five-second question, and this is not one.
     *
     * @return array<string, mixed>
     */
    public function pushOptions(): array
    {
        return ['ttl' => 4 * 60 * 60];
    }
}
