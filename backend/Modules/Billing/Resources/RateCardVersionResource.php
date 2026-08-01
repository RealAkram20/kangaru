<?php

namespace Modules\Billing\Resources;

use App\Support\Money\Shillings;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;

/**
 * @mixin RateCardVersion
 */
class RateCardVersionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'version' => $this->version,
            'effective_from' => $this->effective_from->toDateString(),
            'currency' => $this->currency,
            'rounding_mode' => $this->rounding_mode->value,
            'rounding_mode_label' => $this->rounding_mode->label(),
            'free_waiting_minutes' => $this->free_waiting_minutes,
            'night_starts_at' => $this->night_starts_at,
            'night_ends_at' => $this->night_ends_at,
            'night_multiplier_bp' => $this->night_multiplier_bp,
            // The one fact a client most needs about a version: whether it
            // is sealed. A locked version has priced a real invoice and can
            // never change; an unlocked one can still be superseded before
            // anybody has been billed under it.
            'is_locked' => $this->isLocked(),
            'locked_at' => $this->locked_at,
            'notes' => $this->notes,
            'rates' => $this->whenLoaded('rates', fn () => $this->rates->map(fn (RateCardRate $rate) => [
                'vehicle_category' => $rate->vehicle_category,
                'base_fare_minor' => Shillings::toMinor($rate->baseFare()),
                'per_km_minor' => Shillings::toMinor($rate->perKilometre()),
                'per_waiting_minute_minor' => Shillings::toMinor($rate->perWaitingMinute()),
                'minimum_charge_minor' => Shillings::toMinor($rate->minimumCharge()),
                // Null means uncapped, never "capped at zero".
                'maximum_charge_minor' => $rate->maximumCharge() === null
                    ? null
                    : Shillings::toMinor($rate->maximumCharge()),
            ])),
            'created_at' => $this->created_at,
        ];
    }
}
