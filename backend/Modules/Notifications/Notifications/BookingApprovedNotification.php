<?php

namespace Modules\Notifications\Notifications;

use Modules\Bookings\Models\Booking;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells the person who asked for transport that it was approved.
 *
 * Carries the booking's id rather than the model, so a job sitting on the
 * queue reads the booking as it is when it runs — and so a booking deleted
 * meanwhile fails to load rather than sending a message about a record
 * that no longer exists.
 */
class BookingApprovedNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $bookingId,
        // The phrase the sentence is built around — the model's
        // requestDescription(), which knows a rental has no route to name
        // (ADR-0064). Origin and destination still travel separately below
        // for context(), where they are data rather than prose.
        private readonly string $description,
        private readonly ?string $origin,
        private readonly ?string $destination,
        private readonly ?string $scheduledFor,
    ) {}

    public static function for(Booking $booking): self
    {
        return new self(
            $booking->id,
            $booking->requestDescription(),
            $booking->origin,
            $booking->destination,
            $booking->scheduled_for?->toIso8601String(),
        );
    }

    public function type(): NotificationType
    {
        return NotificationType::BOOKING_APPROVED;
    }

    public function subject(): string
    {
        return "Booking #{$this->bookingId} approved";
    }

    public function body(): string
    {
        // The route is in the sentence because a recipient with several
        // bookings open needs to know which one this is without following
        // the link — the whole point of a notification is that it is read
        // in a list.
        // A rental has no pickup moment and no driver coming — its period
        // is in the booking itself, so the sentence stops at the approval.
        if ($this->origin === null) {
            return "Your {$this->description} has been approved. "
                .'The desk will confirm collection with you.';
        }

        $when = $this->scheduledFor === null
            ? 'as an immediate request'
            : 'for '.date('j M Y \a\t H:i', (int) strtotime($this->scheduledFor));

        return "Your {$this->description} "
            ."has been approved {$when}. A dispatcher will assign a vehicle and driver.";
    }

    public function url(): ?string
    {
        return "/bookings/{$this->bookingId}";
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'booking_id' => $this->bookingId,
            'origin' => $this->origin,
            'destination' => $this->destination,
            'scheduled_for' => $this->scheduledFor,
        ];
    }
}
