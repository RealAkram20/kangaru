<?php

namespace Modules\Billing\Models;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Modules\Fleet\Models\Zone;

/**
 * The prices one rate card version charges for one vehicle category
 * **wherever no zone rate says otherwise**.
 *
 * The money casts, the immutability and the audit trail live on
 * `PricedRate`, shared with `RateCardZoneRate` so the default price and a
 * zone price cannot drift apart on the properties that make them financial
 * records.
 *
 * @property int $rate_card_version_id
 * @property string $vehicle_category
 * @property-read RateCardVersion $version
 * @property-read Collection<int, RateCardZoneRate> $zoneRates
 */
class RateCardRate extends PricedRate
{
    protected $fillable = [
        'tenant_id',
        'rate_card_version_id',
        'vehicle_category',
        'base_fare_minor',
        'per_km_minor',
        'per_waiting_minute_minor',
        'minimum_charge_minor',
        'maximum_charge_minor',
    ];

    /** @return BelongsTo<RateCardVersion, $this> */
    public function version(): BelongsTo
    {
        return $this->belongsTo(RateCardVersion::class, 'rate_card_version_id');
    }

    /** @return HasMany<RateCardZoneRate, $this> */
    public function zoneRates(): HasMany
    {
        return $this->hasMany(RateCardZoneRate::class);
    }

    /**
     * The zone price that overrides this one for a given zone, or null when
     * this category is not priced differently there.
     *
     * Reads the loaded collection rather than querying, so pricing a trip
     * costs no extra round trip and `RateCardResolver`'s eager load is the
     * single place that decides what billing reads.
     */
    public function zoneRateFor(Zone $zone): ?RateCardZoneRate
    {
        return $this->zoneRates->firstWhere('zone_id', $zone->id);
    }

    /** Null: this is the rate that applies where no zone rate does. */
    public function pricingZoneId(): ?int
    {
        return null;
    }

    public function pricingZoneName(): ?string
    {
        return null;
    }
}
