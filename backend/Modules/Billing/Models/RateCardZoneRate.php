<?php

namespace Modules\Billing\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Fleet\Models\Zone;

/**
 * What one rate card version charges for one vehicle category **inside one
 * zone** — the billing half of ADR-0021.
 *
 * It hangs off a `RateCardRate` rather than off the version directly, and
 * that is the whole safety of the design: a zone price cannot exist without
 * the default price it overrides, so a version can never be configured to
 * bill sedans in Kampala and refuse a sedan trip from Jinja. There is no
 * validation rule to forget, because the row has nowhere to attach.
 *
 * It carries the same five amounts as its parent, complete rather than
 * partial. A partial override — "null means inherit" — would mean no single
 * row ever states what a trip in this zone costs, and reconstructing a
 * disputed price would require reading two rows and knowing the merge rule.
 *
 * @property int $rate_card_rate_id
 * @property int $zone_id
 * @property-read RateCardRate $rate
 * @property-read Zone $zone
 */
class RateCardZoneRate extends PricedRate
{
    protected $fillable = [
        'tenant_id',
        'rate_card_rate_id',
        'zone_id',
        'base_fare_minor',
        'per_km_minor',
        'per_waiting_minute_minor',
        'minimum_charge_minor',
        'maximum_charge_minor',
    ];

    /** @return BelongsTo<RateCardRate, $this> */
    public function rate(): BelongsTo
    {
        return $this->belongsTo(RateCardRate::class, 'rate_card_rate_id');
    }

    /**
     * Zones soft-delete (ADR-0021), so retiring one leaves this readable —
     * which is the point: an invoice priced in it last month still has to
     * name it. `withTrashed()` rather than relying on the default scope,
     * because a rate whose zone reads as null would be a rate nobody can
     * explain.
     *
     * @return BelongsTo<Zone, $this>
     */
    public function zone(): BelongsTo
    {
        return $this->belongsTo(Zone::class)->withTrashed();
    }

    public function pricingZoneId(): ?int
    {
        return $this->zone_id;
    }

    public function pricingZoneName(): ?string
    {
        return $this->zone->name;
    }
}
