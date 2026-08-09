<?php

namespace Modules\Dispatch\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Dispatch\Models\DispatchOffer;

/**
 * A job as the driver being offered it sees it (ADR-0024 §3).
 *
 * ## What it deliberately omits
 *
 * **The passenger's name and phone number.** ADR-0024 §7 releases those only
 * once the driver has accepted, and this resource is what is rendered
 * *before* they decide. A number handed to a driver who then declines is a
 * number given away for nothing — and this payload is also what a push
 * notification is built from, which puts it on a lock screen readable by
 * whoever is holding the phone.
 *
 * The pickup address is here, because a driver cannot judge a job without
 * knowing where it starts. That is the trade ADR-0025 §5 records making
 * explicitly.
 *
 * @mixin DispatchOffer
 */
class DispatchOfferResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $order = $this->orderRequest;

        return [
            'id' => $this->id,
            'status' => $this->status->value,

            // Seconds, not just the timestamp. Both are served: the
            // timestamp so a client can run its own countdown against its
            // own clock, and this so the first render is right even on a
            // handset whose clock is minutes out — which is common enough
            // on cheap Android hardware to matter, and would otherwise show
            // a driver a job that had already expired, or one with 40
            // seconds left on a 15-second offer.
            'expires_at' => $this->expires_at->toIso8601String(),
            'expires_in_seconds' => max(0, (int) now()->diffInSeconds($this->expires_at, false)),

            'pickup' => [
                'label' => $order?->pickup_location,
                'latitude' => $order?->pickup_latitude,
                'longitude' => $order?->pickup_longitude,
            ],
            'dropoff' => [
                'label' => $order?->dropoff_location,
                'latitude' => $order?->dropoff_latitude,
                'longitude' => $order?->dropoff_longitude,
            ],
            'service_type' => $order?->service_type->value,
            'reference' => $order?->reference,

            // How far the driver is from the pickup, and the sentences
            // behind the ranking. Served because ADR-0020 §4 requires a
            // ranking somebody can audit — and because "0.4 km away" is the
            // single most useful thing on the screen when deciding.
            'pickup_distance_km' => $this->pickup_distance_km,
            'reasons' => $this->reasons ?? [],

            'vehicle_id' => $this->vehicle_id,
            'vehicle_registration' => $this->whenLoaded('vehicle', fn () => $this->vehicle?->registration_number),
        ];
    }
}