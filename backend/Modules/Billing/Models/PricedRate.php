<?php

namespace Modules\Billing\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Exceptions\FinancialRecordImmutableException;
use App\Support\Money\MoneyMinorCast;
use Brick\Money\Money;
use Illuminate\Database\Eloquent\Model;

/**
 * A complete set of prices the engine can bill a trip with.
 *
 * Two rows answer to this: `RateCardRate`, the price for a vehicle category
 * anywhere, and `RateCardZoneRate`, the price for that category inside one
 * zone. `TripPricingEngine` selects one of them and then never asks which it
 * got — the whole point of a zone rate being a *complete* price rather than
 * a partial override is that the engine has one shape to price.
 *
 * Everything that makes a rate a financial record lives here, so the two
 * cannot drift apart on the properties that matter most:
 *
 * - **Money casts.** Every amount reads back as `Brick\Money\Money`, which
 *   is what makes `$rate->per_km_minor * $km` a TypeError rather than a
 *   silently wrong invoice (AGENTS.md: "Raw integer math on money outside
 *   the value object fails review").
 * - **Immutability.** A rate that could be edited would make its parent
 *   version immutable in name only, and the versioning rule exists to end
 *   arguments about which numbers were in force.
 * - **Auditability.** AGENTS.md requires every mutation to a rate card in
 *   `audit_logs`. Since the only permitted mutation is creation, that is one
 *   row per rate, which is exactly the record a bank asks for.
 *
 * The `@property` names keep the `_minor` suffix because that is the real
 * attribute name; the named accessors below exist so pricing code never has
 * to say `_minor` at all.
 *
 * @property int $id
 * @property int $tenant_id
 * @property Money $base_fare_minor
 * @property Money $per_km_minor
 * @property Money $per_waiting_minute_minor
 * @property Money $minimum_charge_minor
 * @property Money|null $maximum_charge_minor
 */
abstract class PricedRate extends Model
{
    use Auditable, BelongsToTenant;

    /**
     * The columns stay `*_minor` integers in the database; every one of them
     * reads back as Money in PHP.
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

    /**
     * The zone this rate prices, or null when it is the category's default
     * — the rate that applies wherever no zone rate does.
     *
     * This is the value the engine copies onto every invoice line, and null
     * keeps the meaning `invoice_lines.zone` has carried since the table
     * existed: no zone was applied.
     */
    abstract public function pricingZoneId(): ?int;

    /** The zone's name at pricing time, for the issued document. */
    abstract public function pricingZoneName(): ?string;

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
