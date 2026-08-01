<?php

namespace Modules\Billing\Models;

use App\Concerns\BelongsToTenant;
use App\Exceptions\FinancialRecordImmutableException;
use App\Support\Money\MoneyMinorCast;
use Brick\Money\Money;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Enums\RoundingMode;

/**
 * One charge or adjustment on an invoice, stored with the inputs that
 * produced it.
 *
 * AGENTS.md Calculation: "Every invoice line stores its inputs: rate card
 * version, zone, distance, waiting minutes, multipliers applied. An invoice
 * must be fully reproducible from stored data."
 *
 * `recompute()` below is that promise made executable: it recalculates the
 * line's amount from nothing but the line's own stored columns. A test
 * asserts it agrees with `amount`, which is what stops the reproducibility
 * requirement from decaying into a comment.
 *
 * Not Auditable: an invoice line is created with its invoice and can never
 * change, so the invoice's own audit row already records it. Auditing each
 * line would add rows that only ever say "created", once, for something the
 * parent already covers.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $invoice_id
 * @property int $line_number
 * @property InvoiceLineType $type
 * @property string $description
 * @property string $quantity
 * @property Money $unit_amount_minor
 * @property Money $amount_minor
 * @property int $rate_card_version_id
 * @property string $vehicle_category
 * @property string|null $zone
 * @property string|null $distance_km
 * @property int|null $waiting_minutes
 * @property int $multiplier_bp
 * @property RoundingMode $rounding_mode
 */
class InvoiceLine extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'invoice_id',
        'line_number',
        'type',
        'description',
        'quantity',
        'unit_amount_minor',
        'amount_minor',
        'rate_card_version_id',
        'vehicle_category',
        'zone',
        'distance_km',
        'waiting_minutes',
        'multiplier_bp',
        'rounding_mode',
    ];

    protected function casts(): array
    {
        return [
            'line_number' => 'integer',
            'type' => InvoiceLineType::class,
            'quantity' => 'decimal:2',
            'unit_amount_minor' => MoneyMinorCast::class,
            'amount_minor' => MoneyMinorCast::class,
            'distance_km' => 'decimal:2',
            'waiting_minutes' => 'integer',
            'multiplier_bp' => 'integer',
            'rounding_mode' => RoundingMode::class,
        ];
    }

    public static function booted(): void
    {
        static::updating(function (self $line) {
            throw new FinancialRecordImmutableException($line, 'edited');
        });

        static::deleting(function (self $line) {
            throw new FinancialRecordImmutableException($line, 'deleted');
        });
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function rateCardVersion(): BelongsTo
    {
        return $this->belongsTo(RateCardVersion::class, 'rate_card_version_id');
    }

    public function amount(): Money
    {
        return $this->amount_minor;
    }

    public function unitAmount(): Money
    {
        return $this->unit_amount_minor;
    }

    /**
     * The single definition of a line's arithmetic:
     *
     *     amount = unit_amount x quantity x (multiplier_bp / 10000)
     *
     * TripPricingEngine calls this to price a line and recompute() calls it
     * to re-derive one from storage, so the two cannot drift apart. If the
     * formula ever needs a second shape, it needs a second line type — not
     * a branch in here.
     *
     * The multiplication order matters and is fixed: quantity first, then
     * the multiplier. Rounding twice in a different order can land a
     * shilling either side, and an invoice that cannot be reproduced to the
     * shilling is the dispute AGENTS.md wants ended.
     */
    public static function computeAmount(Money $unitAmount, string $quantity, int $multiplierBp, RoundingMode $rounding): Money
    {
        $mode = $rounding->toBrick();

        return $unitAmount
            ->multipliedBy($quantity, $mode)
            ->multipliedBy($multiplierBp, $mode)
            ->dividedBy(RateCardVersion::NO_MULTIPLIER_BP, $mode);
    }

    /**
     * Recomputes this line's amount from nothing but its own stored
     * columns. If this ever disagrees with `amount()`, the line was not
     * reproducible and the invoice cannot be defended in a billing dispute
     * — the exact failure AGENTS.md requires this table to make impossible.
     * `InvoiceGenerationTest` asserts the agreement on every line it issues.
     */
    public function recompute(): Money
    {
        return self::computeAmount(
            $this->unitAmount(),
            (string) $this->quantity,
            $this->multiplier_bp,
            $this->rounding_mode,
        );
    }
}
