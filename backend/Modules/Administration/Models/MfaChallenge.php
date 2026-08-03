<?php

namespace Modules\Administration\Models;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A password proved, a second factor still owed (ADR-0008 decision 2).
 *
 * This is the intermediate state of a two-step login, and the reason it is
 * a row rather than a token is the whole of decision 2: **a partial token
 * is a token.** Minting a Sanctum token with an `mfa-pending` ability and
 * upgrading it later is the common shape and is rejected here — it is
 * bearer credential material that exists before the factor was proved, and
 * every endpoint in the application would then depend on an ability check
 * somebody has to remember to write. Fail-closed is easier when the thing
 * does not exist yet.
 *
 * A challenge authenticates nothing. It is a claim ticket: it names the
 * account whose password was accepted, and it can be exchanged exactly once
 * for a token if a valid code arrives within five minutes.
 *
 * Not `Auditable`: a challenge is issued on every privileged login and
 * consumed seconds later, so auditing it would bury the events that matter
 * (enrolment, recovery-code use) under routine noise. What gets audited is
 * the outcome, in `MfaService`.
 *
 * @property int $id
 * @property int $user_id
 * @property string $token_hash
 * @property CarbonInterface $expires_at
 * @property CarbonInterface|null $consumed_at
 * @property CarbonInterface $created_at
 */
class MfaChallenge extends Model
{
    protected $fillable = ['user_id', 'token_hash', 'expires_at', 'consumed_at'];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Live: not yet spent, not yet expired.
     *
     * Both halves matter and they fail differently. Without the
     * `consumed_at` check a captured challenge id could be replayed with a
     * second code; without `expires_at` a challenge left open on an
     * abandoned login stays exchangeable indefinitely.
     *
     * @param  Builder<MfaChallenge>  $query
     * @return Builder<MfaChallenge>
     */
    public function scopeUsable(Builder $query): Builder
    {
        return $query->whereNull('consumed_at')->where('expires_at', '>', now());
    }
}
