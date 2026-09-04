<?php

namespace Modules\Fleet\Models;

use App\Models\Operator;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A fleet changing hands, pending until the new owner confirms.
 *
 * The row is the whole of the pending state: no account, no credential, no
 * change to the sitting owner. `OwnershipTransferService` is the only thing
 * that ever holds the plaintext token, exactly as `InvitationService` says of
 * its own.
 *
 * @property int $id
 * @property int $operator_id
 * @property string $name
 * @property string $email
 * @property string $token_hash
 * @property CarbonInterface $expires_at
 * @property CarbonInterface|null $accepted_at
 * @property int|null $invited_by
 */
class OwnershipTransfer extends Model
{
    /** The invitation's own window, and for its reasons: long enough for
     * somebody on leave, short enough that a forwarded email goes stale. */
    public const TTL_DAYS = 7;

    protected $fillable = [
        'operator_id',
        'name',
        'email',
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
     * Whether this link still hands the fleet over. Used and expired stay
     * distinguishable to the caller — they send the reader to different
     * places, as `Invitation::isUsable()` argues.
     */
    public function isUsable(): bool
    {
        return $this->accepted_at === null && $this->expires_at->isFuture();
    }

    /** @return BelongsTo<Operator, $this> */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(Operator::class);
    }

    /** @return BelongsTo<User, $this> */
    public function invitedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }
}
