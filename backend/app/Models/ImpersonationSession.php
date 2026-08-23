<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * One support session, from the moment somebody became somebody else to the
 * moment they stopped (ADR-0056).
 *
 * ## The row is the record, not a side effect of one
 *
 * ADR-0056 §2 requires that starting and ending a session are **themselves**
 * audited, not only the writes inside one: *"a session that opened, looked, and
 * changed nothing must still leave a record — reading a bank's trip history is
 * the act, whether or not anything was written."* So this table is the
 * evidence, and `audit_logs.impersonator_id` is the cross-reference from each
 * individual act back to it.
 *
 * ## Deliberately not `Auditable`
 *
 * Every other model in this platform records its own creates and updates to
 * `audit_logs`. This one does not, and the reason is that it would be circular:
 * `AuditLog::record()` reads the *active* session to fill `impersonator_id`, so
 * auditing the session's own creation would either attribute the session to
 * itself or attribute it to nothing, depending on ordering. The service writes
 * one explicit audit row for the start and one for the end instead, where the
 * subject is the session and the actor is unambiguous.
 *
 * @property int $actor_user_id
 * @property string $subject_type
 * @property int $subject_id
 * @property string $reason
 * @property CarbonInterface $started_at
 * @property CarbonInterface $expires_at
 * @property CarbonInterface|null $ended_at
 */
class ImpersonationSession extends Model
{
    /**
     * Thirty minutes, per ADR-0056 §5.
     *
     * Long enough for a support call, short enough that a session left open on
     * a locked laptop is not a standing key to somebody's account. Ending is
     * explicit as well — this is the backstop for the agent who closed the tab
     * instead.
     */
    public const LIFETIME_MINUTES = 30;

    protected $fillable = [
        'actor_user_id',
        'subject_type',
        'subject_id',
        'reason',
        'started_at',
        'expires_at',
        'ended_at',
        'ip_address',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'expires_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * Still running: not ended by hand, and not yet timed out.
     *
     * **Both halves, every time.** Checking only `ended_at` would leave an
     * abandoned session live indefinitely, and checking only `expires_at`
     * would ignore an agent who deliberately stopped. The index on
     * `(actor_user_id, ended_at)` is what keeps this cheap on the hot path,
     * because every request an acting account makes asks this question.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeLive(Builder $query): Builder
    {
        return $query->whereNull('ended_at')->where('expires_at', '>', now());
    }

    public function isLive(): bool
    {
        return $this->ended_at === null && $this->expires_at->isFuture();
    }
}
