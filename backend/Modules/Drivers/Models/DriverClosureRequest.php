<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Modules\Drivers\Enums\ClosureRequestStatus;

/**
 * A driver asking for their account to be closed (ADR-0043).
 *
 * **Closing is not deleting.** Confirming deactivates the driver and detaches
 * their sign-in; trips, ledger entries, invoices and audit rows are untouched,
 * because `master-plan.md` §6 stakes the product on those staying reproducible.
 *
 * `Auditable`, and the reason is the same as the payout account's: ending
 * somebody's ability to work is a decision the office may be asked to account
 * for, and the log is what makes "who closed my account, and when" answerable.
 *
 * @property int $id
 * @property int $driver_id
 * @property ClosureRequestStatus $status
 * @property string|null $reason
 * @property int|null $reviewed_by_user_id
 * @property Carbon|null $reviewed_at
 * @property string|null $decline_reason
 * @property Carbon|null $closed_at
 *
 * `$driver` is declared rather than left to inference: without it PHPStan reads
 * the relation differently in different contexts — nullable in one, never-null
 * in another — and no single expression in the resource satisfied both. It is
 * genuinely nullable to the type system even though `driver_id` is a
 * constrained, non-nullable key, because nothing stops a caller reading it
 * before it has been loaded.
 * @property-read Driver|null $driver
 */
class DriverClosureRequest extends Model
{
    use Auditable;

    protected $fillable = [
        'driver_id',
        'status',
        'reason',
    ];

    protected function casts(): array
    {
        return [
            'status' => ClosureRequestStatus::class,
            'reviewed_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Driver, $this>
     */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }
}
