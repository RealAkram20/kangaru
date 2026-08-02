<?php

namespace Modules\Notifications\Notifications;

use Modules\Bookings\Models\Booking;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells the person who asked for transport that it was refused, and why.
 *
 * The reason is not optional and is not summarised. `BookingService::reject`
 * requires one, and a refusal delivered without it is the message that
 * generates the phone call this module exists to prevent.
 */
class BookingRejectedNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $bookingId,
        private readonly string $origin,
        private readonly string $destination,
        private readonly ?string $reason,
    ) {}

    public static function for(Booking $booking): self
    {
        return new self(
            $booking->id,
            $booking->origin,
            $booking->destination,
            $booking->decision_reason,
        );
    }

    public function type(): NotificationType
    {
        return NotificationType::BOOKING_REJECTED;
    }

    public function subject(): string
    {
        return "Booking #{$this->bookingId} not approved";
    }

    public function body(): string
    {
        // The null branch is unreachable through the API — the reject
        // endpoint requires a reason — but this reads a nullable column, and
        // "declined for the following reason: " followed by nothing is a
        // worse thing to send than a plainly incomplete sentence.
        $because = $this->reason === null || trim($this->reason) === ''
            ? 'No reason was recorded. Please contact your dispatcher.'
            : "Reason given: {$this->reason}";

        return "Your transport request from {$this->origin} to {$this->destination} "
            ."was not approved. {$because}";
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
            'reason' => $this->reason,
        ];
    }
}
