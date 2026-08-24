<?php

namespace Modules\Administration\Models;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One live invitation to set a password and get in.
 *
 * The plaintext token exists for exactly as long as it takes to put it in an
 * email. It is never stored, never logged, and `InvitationService` is the only
 * thing that ever holds it.
 *
 * @property int $id
 * @property int $user_id
 * @property string $token_hash
 * @property CarbonInterface $expires_at
 * @property CarbonInterface|null $accepted_at
 * @property int|null $invited_by
 */
class Invitation extends Model
{
    /** Long enough for somebody on leave, short enough that a forwarded email goes stale. */
    public const TTL_DAYS = 7;

    /** How long before expiry the one reminder goes out. */
    public const REMIND_WITHIN_HOURS = 24;

    protected $fillable = [
        'user_id',
        'token_hash',
        'expires_at',
        'accepted_at',
        'invited_by',
    ];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }

    /**
     * Whether this link still opens the door.
     *
     * Used *and* expired are asked separately by the caller, because the two
     * deserve different sentences: somebody who already accepted should be
     * sent to sign in, and somebody whose link lapsed should be told to ask
     * for another. Collapsing both into "invalid" makes the first person ask
     * for a link they do not need.
     */
    public function isUsable(): bool
    {
        return $this->accepted_at === null && $this->expires_at->isFuture();
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<User, $this> */
    public function invitedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }
}
