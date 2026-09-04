<?php

namespace Modules\Billing\Resources;

use App\Support\Money\Shillings;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Models\PricedRate;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Models\RateCardZoneRate;

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
            'distance_policy' => $this->distance_policy->value,
            // The one fact a client most needs about a version: whether it
            // is sealed. A locked version has priced a real invoice and can
            // never change; an unlocked one can still be superseded before
            // anybody has been billed under it.
            'is_locked' => $this->isLocked(),
            'locked_at' => $this->locked_at,
            'notes' => $this->notes,
            'rates' => $this->whenLoaded('rates', fn () => $this->rates->map(fn (RateCardRate $rate) => [
                'vehicle_category' => $rate->vehicle_category,
                ...self::amounts($rate),
                // Nested under the category they override, mirroring both
                // the storage and the request payload. A flat list would
                // make the client join them back up, and getting that join
                // wrong shows a finance officer a price that is not theirs.
                'zone_rates' => $rate->zoneRates->map(fn (RateCardZoneRate $zoneRate) => [
                    'zone_id' => $zoneRate->zone_id,
                    // The zone is loaded `withTrashed()`, so a retired zone
                    // still names itself here rather than reading as null on
                    // a rate card somebody has to explain.
                    'zone_name' => $zoneRate->pricingZoneName(),
                    ...self::amounts($zoneRate),
                ])->values(),
            ])),
            'created_at' => $this->created_at,
        ];
    }

    /**
     * The five amounts every rate carries, serialised identically whether
     * it is a category's default price or a zone's override of it. One
     * function, so the two shapes cannot drift and a client can parse them
     * with one reader.
     *
     * @return array<string, int|null>
     */
    private static function amounts(PricedRate $rate): array
    {
        return [
            'base_fare_minor' => Shillings::toMinor($rate->baseFare()),
            'per_km_minor' => Shillings::toMinor($rate->perKilometre()),
            'per_waiting_minute_minor' => Shillings::toMinor($rate->perWaitingMinute()),
            'minimum_charge_minor' => Shillings::toMinor($rate->minimumCharge()),
            // Null means uncapped, never "capped at zero".
            'maximum_charge_minor' => $rate->maximumCharge() === null
                ? null
                : Shillings::toMinor($rate->maximumCharge()),
        ];
    }
}
