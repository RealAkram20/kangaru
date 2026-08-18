<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Drivers\Enums\SettlementRequestKind;
use Modules\Drivers\Enums\SettlementRequestStatus;

/**
 * A driver asking the office to settle, in either direction (ADR-0032).
 *
 * **This is not a balance and must never be summed into one.** The wallet
 * total comes from `driver_ledger_entries` alone. A row here is a request a
 * human has not yet acted on, and if a pending one could move a balance a
 * driver could request their way out of what they owe.
 *
 * `Auditable` because this is the first surface where a staff action directly
 * changes what a driver is owed — who confirmed, when, and from which IP is
 * the point rather than a formality.
 *
 * @property int $id
 * @property int $driver_id
 * @property int|null $trip_id The trip a tip was taken on (ADR-0034 §1); null on the other two kinds.
 * @property SettlementRequestKind $kind
 * @property SettlementRequestStatus $status
 * @property int $amount_minor Always positive; direction lives in `kind`.
 * @property string $currency
 * @property string|null $note
 * @property int|null $reviewed_by_user_id
 * @property CarbonInterface|null $reviewed_at
 * @property string|null $decline_reason
 * @property int|null $ledger_entry_id
 * @property CarbonInterface $created_at
 * @property CarbonInterface $updated_at
 * @property-read Driver|null $driver
 */
class DriverSettlementRequest extends Model
{
    use Auditable;

    protected $fillable = [
        'driver_id',
        'trip_id',
        'kind',
        'status',
        'amount_minor',
        'currency',
        'note',
        'reviewed_by_user_id',
        'reviewed_at',
        'decline_reason',
        'ledger_entry_id',
    ];

    protected function casts(): array
    {
        return [
            'kind' => SettlementRequestKind::class,
            'status' => SettlementRequestStatus::class,
            'amount_minor' => 'integer',
            'reviewed_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /** @return BelongsTo<User, $this> */
    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }

    /** @return BelongsTo<DriverLedgerEntry, $this> */
    public function ledgerEntry(): BelongsTo
    {
        return $this->belongsTo(DriverLedgerEntry::class, 'ledger_entry_id');
    }

    /**
     * Still waiting on the office.
     *
     * @param  Builder<DriverSettlementRequest>  $query
     * @return Builder<DriverSettlementRequest>
     */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->where('status', SettlementRequestStatus::PENDING->value);
    }
}
