<?php

namespace Modules\Administration\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A provider identity linked to an account (ADR-0028 §3).
 *
 * Deliberately dumb: no tokens, no refresh secrets, no profile mirror. The
 * provider re-proves the identity on every sign-in, so the only thing worth
 * storing is the link itself and what was asserted when it was made.
 *
 * @property int $id
 * @property int $user_id
 * @property string $provider
 * @property string $provider_id
 * @property string $email_at_link
 */
class SocialIdentity extends Model
{
    protected $fillable = ['user_id', 'provider', 'provider_id', 'email_at_link'];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
