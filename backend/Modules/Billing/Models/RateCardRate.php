<?php

namespace Modules\Billing\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Exceptions\FinancialRecordImmutableException;
use App\Support\Money\MoneyMinorCast;
use Brick\Money\Money;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The prices one rate card version charges for one vehicle category.
 *
 * Immutable for the same reason its parent version is — a version whose
 * child rates could still be edited would be immutable in name only.
 *
 * Every money attribute is cast to Brick\Money\Money, so the pricing engine
 * cannot accidentally do integer arithmetic on a rate: `$rate->per_km_minor
 * * $km` is a TypeError, which is the point (AGENTS.md: "Raw integer math
 * on money outside the value object fails review").
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $rate_card_version_id
 * @property string $vehicle_category
 * @property Money $base_fare
 * @property Money $per_km
 * @property Money $per_waiting_minute
 * @property Money $minimum_charge
 * @property Money|null $maximum_charge
 */
class RateCardRate extends Model
{
    use Auditable, BelongsToTenant;

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

    /**
     * The columns stay `*_minor` integers in the database; every one of
     * them reads back as Money in PHP. The named accessors below exist so
     * pricing code never has to mention `_minor` at all — a name that still
     * said `_minor` invites someone to treat the value as an int again.
     */
    protected function casts(): array
    {
        return [
            'base_fare_minor' => MoneyMinorCast::class,
            'per_km_minor' => MoneyMinorCast::class,
            'per_waiting_minute_minor' => MoneyMinorCast::class,
            'minimum_charge_minor' => MoneyMinorCast::class,
            'maximum_charge_minor' => MoneyMinorCast::class,
        ];
    }

    public static function booted(): void
    {
        static::updating(function (self $rate) {
            throw new FinancialRecordImmutableException($rate, 'edited');
        });

        static::deleting(function (self $rate) {
            throw new FinancialRecordImmutableException($rate, 'deleted');
        });
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(RateCardVersion::class, 'rate_card_version_id');
    }

    public function baseFare(): Money
    {
        return $this->base_fare_minor;
    }

    public function perKilometre(): Money
    {
        return $this->per_km_minor;
    }

    public function perWaitingMinute(): Money
    {
        return $this->per_waiting_minute_minor;
    }

    public function minimumCharge(): Money
    {
        return $this->minimum_charge_minor;
    }

    /** Null means uncapped, never "capped at zero". */
    public function maximumCharge(): ?Money
    {
        return $this->maximum_charge_minor;
    }
}
