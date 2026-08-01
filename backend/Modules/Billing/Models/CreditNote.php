<?php

namespace Modules\Billing\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Exceptions\FinancialRecordImmutableException;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Money\MoneyMinorCast;
use Brick\Money\Money;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * A correction to an issued invoice.
 *
 * AGENTS.md Integrity: "corrections are credit notes or adjustments, never
 * silent edits to issued invoices." This is the only mechanism the module
 * offers for changing what a client owes, and it is itself append-only —
 * a credit note issued in error is corrected by... nothing. It stands, and
 * the record shows both. That is the property an auditor is checking for.
 *
 * Written exclusively by Modules\Billing\Services\CreditNoteService, which
 * enforces the one invariant the database cannot: the total credited
 * against an invoice may never exceed what the invoice charged.
 *
 * @property int $id
 * @property string $uuid
 * @property int $tenant_id
 * @property int $invoice_id
 * @property string $credit_note_number
 * @property string $currency
 * @property Money $total_minor
 * @property string $reason
 * @property string $idempotency_key
 * @property CarbonInterface $issued_at
 */
class CreditNote extends Model
{
    use Auditable, BelongsToTenant;

    protected $fillable = [
        'uuid',
        'tenant_id',
        'invoice_id',
        'credit_note_number',
        'currency',
        'total_minor',
        'reason',
        'idempotency_key',
        'issued_at',
        'issued_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            'total_minor' => MoneyMinorCast::class,
            'issued_at' => 'datetime',
        ];
    }

    public static function booted(): void
    {
        static::creating(function (self $note) {
            $note->uuid ??= (string) Str::uuid7();
        });

        static::updating(function (self $note) {
            throw new FinancialRecordImmutableException($note, 'edited');
        });

        static::deleting(function (self $note) {
            throw new FinancialRecordImmutableException($note, 'deleted');
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function lines(): HasMany
    {
        return $this->hasMany(CreditNoteLine::class)->orderBy('line_number');
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function issuedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'issued_by_user_id');
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** Stored positive: the amount taken off the invoice. */
    public function total(): Money
    {
        return $this->total_minor;
    }
}
