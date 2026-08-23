<?php

namespace Modules\Drivers\Models;

use App\Models\Operator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A driver's contract with Kangaru for walk-in work (ADR-0055 §5).
 *
 * ## The chain, and why it is four states rather than a boolean
 *
 * The driver asks, their fleet consents, Kangaru approves. Each step is
 * somebody else's, so a single "approved" flag would lose the one state the
 * queue is built on — **consented, waiting on head office** — and with it the
 * ability to say who a request is currently blocked on.
 *
 * ```
 *   REQUESTED ──fleet consents──▶ AWAITING_KANGARU ──Kangaru approves──▶ ACTIVE
 *       │                                │
 *       └──── fleet refuses ─────────────┴──── Kangaru refuses ────▶ REFUSED
 * ```
 *
 * A driver who **owns their vehicle** enters at `AWAITING_KANGARU`: there is
 * no fleet to ask, which is precisely the case ADR-0055 §5 waives consent for.
 * The waiver is expressed by `drivers.owns_vehicle` (ADR-0048 §7) rather than
 * a new column, because it is the same fact.
 *
 * @property int $id
 * @property int $driver_id
 * @property int|null $operator_id
 * @property string $status
 * @property Carbon|null $fleet_answered_at
 * @property Carbon|null $kangaru_answered_at
 * @property string|null $refused_reason
 */
class DriverWalkInContract extends Model
{
    /** The driver has asked, and their fleet has not answered. */
    public const REQUESTED = 'requested';

    /** The fleet has consented. Head office has not answered. */
    public const AWAITING_KANGARU = 'awaiting_kangaru';

    /** Both said yes. The driver may take walk-in work. */
    public const ACTIVE = 'active';

    /** Somebody said no. `refused_reason` says who and why, if they said. */
    public const REFUSED = 'refused';

    protected $fillable = [
        'driver_id',
        'operator_id',
        'status',
        'fleet_answered_at',
        'kangaru_answered_at',
        'refused_reason',
    ];

    protected function casts(): array
    {
        return [
            'fleet_answered_at' => 'datetime',
            'kangaru_answered_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * The fleet that consented — read from this row and never through the
     * driver.
     *
     * A driver can move between fleets. Which fleet agreed is a fact about the
     * contract at the moment consent was given, and deriving it from
     * `drivers.operator_id` would silently rewrite history the first time
     * somebody changed employer: a fleet that never agreed to anything would
     * appear to have consented.
     *
     * @return BelongsTo<Operator, $this>
     */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(Operator::class);
    }

    /**
     * Contracts a fleet has been asked about and has not answered.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeAwaitingFleet(Builder $query, int $operatorId): Builder
    {
        return $query->where('operator_id', $operatorId)->where('status', self::REQUESTED);
    }

    /**
     * The queue head office works: consented, waiting on Kangaru, oldest
     * first — because the driver who has waited longest is the one to answer.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeAwaitingKangaru(Builder $query): Builder
    {
        return $query->where('status', self::AWAITING_KANGARU)->orderBy('fleet_answered_at');
    }

    /** Whether this driver may actually take walk-in work right now. */
    public function isLive(): bool
    {
        return $this->status === self::ACTIVE;
    }
}
