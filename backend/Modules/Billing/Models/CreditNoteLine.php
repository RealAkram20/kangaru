<?php

namespace Modules\Billing\Models;

use App\Concerns\BelongsToTenant;
use App\Exceptions\FinancialRecordImmutableException;
use App\Support\Money\MoneyMinorCast;
use Brick\Money\Money;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One item of a credit note, optionally attributed to the invoice line it
 * corrects.
 *
 * Not Auditable, for the same reason InvoiceLine is not: lines are created
 * with their parent and can never change, so the credit note's own audit
 * row already covers them.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $credit_note_id
 * @property int $line_number
 * @property int|null $invoice_line_id
 * @property string $description
 * @property Money $amount_minor
 */
class CreditNoteLine extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'credit_note_id',
        'line_number',
        'invoice_line_id',
        'description',
        'amount_minor',
    ];

    protected function casts(): array
    {
        return [
            'line_number' => 'integer',
            'amount_minor' => MoneyMinorCast::class,
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

    /** @return BelongsTo<CreditNote, $this> */
    public function creditNote(): BelongsTo
    {
        return $this->belongsTo(CreditNote::class);
    }

    /**
     * Null on a goodwill or settlement credit that corrects no one line.
     *
     * @return BelongsTo<InvoiceLine, $this>
     */
    public function invoiceLine(): BelongsTo
    {
        return $this->belongsTo(InvoiceLine::class);
    }

    public function amount(): Money
    {
        return $this->amount_minor;
    }
}
