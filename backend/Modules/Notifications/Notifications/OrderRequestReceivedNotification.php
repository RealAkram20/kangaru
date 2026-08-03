<?php

namespace Modules\Notifications\Notifications;

use Modules\Bookings\Models\OrderRequest;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells the dispatch desk a walk-in order arrived (ADR-0012 §4).
 *
 * Carries scalars rather than the model for the same queue-safety reason as
 * BookingApprovedNotification.
 */
class OrderRequestReceivedNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $orderRequestId,
        private readonly string $reference,
        private readonly string $serviceType,
        private readonly ?string $pickup,
    ) {}

    public static function for(OrderRequest $request): self
    {
        return new self(
            $request->id,
            $request->reference,
            $request->service_type->value,
            $request->pickup_location,
        );
    }

    public function type(): NotificationType
    {
        return NotificationType::ORDER_REQUEST_RECEIVED;
    }

    public function subject(): string
    {
        return "Walk-in order {$this->reference}";
    }

    public function body(): string
    {
        $service = str_replace('_', ' ', $this->serviceType);
        $where = $this->pickup === null ? '' : " from {$this->pickup}";

        return "A visitor asked for a {$service}{$where}. "
            ."Quote {$this->reference} when you call them back.";
    }

    public function url(): ?string
    {
        return '/order-requests';
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'order_request_id' => $this->orderRequestId,
            'reference' => $this->reference,
            'service_type' => $this->serviceType,
        ];
    }
}
