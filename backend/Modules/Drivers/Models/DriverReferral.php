<?php

namespace Modules\Drivers\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One driver introduced another (ADR-0037).
 *
 * The reward itself is a `referral` entry in `driver_ledger_entries` like
 * every other credit. This row is the *relationship*, and it exists for two
 * things the ledger cannot do:
 *
 * **It makes a second reward impossible.** `referred_driver_id` is unique, so
 * a person can be introduced once, ever — including across two applications,
 * which ADR-0027 §5 deliberately allows to be submitted.
 *
 * **It freezes what was promised.** `code`, `trip_target` and `amount_minor`
 * are all things that can change afterwards: a driver may be issued a new
 * code, and both figures are admin-settable. A referral explained only by
 * "the current reward" is one nobody can defend a year later — ADR-0029 §3's
 * rule about writing the commission rate into an entry, applied again.
 *
 * `qualified_at` and `ledger_entry_id` are written together in one
 * transaction, so a row that claims to have been paid and points at nothing
 * cannot exist.
 *
 * @property int $id
 * @property int $referrer_driver_id
 * @property int $referred_driver_id
 * @property string $code The code as it was used, not as it is now.
 * @property int $trip_target
 * @property int $amount_minor
 * @property string $currency
 * @property CarbonInterface|null $qualified_at
 * @property int|null $ledger_entry_id
 * @property-read Driver|null $referrer
 * @property-read Driver|null $referred
 */
class DriverReferral extends Model
{
    protected $fillable = [
        'referrer_driver_id',
        'referred_driver_id',
        'code',
        'trip_target',
        'amount_minor',
        'currency',
        'qualified_at',
        'ledger_entry_id',
    ];

    protected function casts(): array
    {
        return [
            'qualified_at' => 'datetime',
            'trip_target' => 'integer',
            'amount_minor' => 'integer',
        ];
    }

    /**
     * The driver who gets paid.
     *
     * @return BelongsTo<Driver, $this>
     */
    public function referrer(): BelongsTo
    {
        return $this->belongsTo(Driver::class, 'referrer_driver_id');
    }

    /**
     * The driver they introduced.
     *
     * @return BelongsTo<Driver, $this>
     */
    public function referred(): BelongsTo
    {
        return $this->belongsTo(Driver::class, 'referred_driver_id');
    }

    /** Whether the reward has been paid. */
    public function isQualified(): bool
    {
        return $this->qualified_at !== null;
    }
}
