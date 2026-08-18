<?php

namespace Modules\Notifications\Notifications;

use Modules\Dispatch\Models\DispatchOffer;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells a driver a job is waiting for them (ADR-0024 §3, ADR-0025 §5).
 *
 * Carries scalars rather than the model, for the queue-safety reason every
 * other notification here gives: a serialised model is re-fetched by a worker
 * that may run after the row has moved on, and the offer this describes has a
 * fifteen-second life.
 *
 * ## What it deliberately does not say
 *
 * The passenger's name and number. ADR-0025 §5 is explicit: a push lands on a
 * lock screen readable by whoever is holding the phone, and ADR-0024 §7
 * releases those details only *after* the driver accepts. A driver who
 * declines should learn nothing about the person they declined.
 *
 * The pickup **is** here, because a driver cannot judge a job without knowing
 * where it starts — that is the trade ADR-0025 §5 records making explicitly.
 */
class TripOfferedNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $offerId,
        private readonly ?string $pickup,
        private readonly ?float $distanceKm,
        private readonly int $expiresInSeconds,
    ) {}

    public static function for(DispatchOffer $offer): self
    {
        return new self(
            $offer->id,
            $offer->orderRequest?->pickup_location,
            $offer->pickup_distance_km === null ? null : (float) $offer->pickup_distance_km,
            // Computed here rather than sent as a timestamp: a push is read
            // on a handset whose clock may be minutes out, and "15 seconds"
            // survives that where "expires at 14:03:12" does not. The same
            // reasoning as `DispatchOfferResource::expires_in_seconds`.
            max(0, (int) now()->diffInSeconds($offer->expires_at, false)),
        );
    }

    public function type(): NotificationType
    {
        return NotificationType::TRIP_OFFERED;
    }

    public function subject(): string
    {
        // Short enough to survive a lock screen's truncation, and the
        // distance is the single most useful fact for deciding.
        return $this->distanceKm === null
            ? 'New job'
            : sprintf('New job — %.1f km away', $this->distanceKm);
    }

    public function body(): string
    {
        $where = $this->pickup === null ? 'A passenger is waiting' : "Pickup at {$this->pickup}";

        return "{$where}. Tap to accept within {$this->expiresInSeconds} seconds.";
    }

    /**
     * Null, deliberately.
     *
     * `url()` is a path into the *SPA*, and a driver holding this
     * notification is not in a browser. The app routes from `context()`
     * below — `offer_id` is what its tap handler opens.
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
            'offer_id' => $this->offerId,
            'expires_in_seconds' => $this->expiresInSeconds,
            'pickup_distance_km' => $this->distanceKm,
        ];
    }
}
