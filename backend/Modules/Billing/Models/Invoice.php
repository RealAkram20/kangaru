<?php

namespace Modules\Billing\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Concerns\RecordsActingFleet;
use App\Exceptions\FinancialRecordImmutableException;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Money\MoneyMinorCast;
use App\Support\Money\Shillings;
use Brick\Money\Money;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;
use Modules\Trips\Models\Trip;

/**
 * An issued invoice for one completed trip.
 *
 * There is no draft state and no status column. An invoice row exists only
 * because Modules\Billing\Services\InvoiceService issued it inside a
 * transaction, and from that instant it is final: AGENTS.md requires
 * corrections to be credit notes, "never silent edits to issued invoices",
 * so this model refuses every update and delete outright.
 *
 * Written exclusively by InvoiceService — never constructed elsewhere. The
 * invoice number in particular must come from the locked counter, and a
 * second creation path would be a second way to produce a duplicate.
 *
 * @property int $id
 * @property string $uuid
 * @property int $tenant_id
 * @property string $invoice_number
 * @property int $trip_id
 * @property int $rate_card_version_id
 * @property string $currency
 * @property Money $total_minor
 * @property string $idempotency_key
 * @property CarbonInterface $issued_at
 */
class Invoice extends Model
{
    use Auditable, BelongsToTenant, RecordsActingFleet;

    protected $fillable = [
        'uuid',
        'tenant_id',
        // Which fleet issued it — taken from the trip being billed, so the
        // document and its number belong to the same series (ADR-0055 §6).
        'operator_id',
        'invoice_number',
        'trip_id',
        'rate_card_version_id',
        'currency',
        'total_minor',
        'idempotency_key',
        'issued_at',
        'issued_by_user_id',
        'notes',
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
        static::creating(function (self $invoice) {
            $invoice->uuid ??= (string) Str::uuid7();
        });

        static::updating(function (self $invoice) {
            throw new FinancialRecordImmutableException($invoice, 'edited');
        });

        static::deleting(function (self $invoice) {
            throw new FinancialRecordImmutableException($invoice, 'deleted');
        });
    }

    /** External references expose the uuid, never the sequential id. */
    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /** @return HasMany<InvoiceLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(InvoiceLine::class)->orderBy('line_number');
    }

    /** @return HasMany<CreditNote, $this> */
    public function creditNotes(): HasMany
    {
        return $this->hasMany(CreditNote::class)->orderBy('id');
    }

    /** @return BelongsTo<Trip, $this> */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    /** @return BelongsTo<RateCardVersion, $this> */
    public function rateCardVersion(): BelongsTo
    {
        return $this->belongsTo(RateCardVersion::class, 'rate_card_version_id');
    }

    /** @return BelongsTo<User, $this> */
    public function issuedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'issued_by_user_id');
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function total(): Money
    {
        return $this->total_minor;
    }

    /**
     * How much of this invoice has been credited back.
     *
     * Derived from the credit notes rather than stored on the invoice: a
     * cached column would have to be updated, and this model does not
     * permit updates at all. Callers that need it inside a transaction
     * should go through InvoiceRepository, which reads it under the
     * invoice's row lock.
     */
    public function creditedTotal(): Money
    {
        return $this->creditNotes
            ->reduce(
                fn (Money $carry, CreditNote $note) => $carry->plus($note->total()),
                Shillings::zero(),
            );
    }

    /** What is still owed: the issued total less everything credited. */
    public function balance(): Money
    {
        return $this->total()->minus($this->creditedTotal());
    }
}
