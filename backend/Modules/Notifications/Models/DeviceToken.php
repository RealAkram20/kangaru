<?php

namespace Modules\Notifications\Models;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One app installation that can be pushed to (ADR-0025 §4).
 *
 * Deliberately **not** `Auditable`. Every other model this platform audits is
 * a decision somebody made — a rate card, a role, a dispatch offer. A device
 * token is a routing address that churns on its own: the OS reissues it, the
 * app re-registers on every sign-in, and an audit trail of that is noise that
 * would bury the entries somebody actually needs to read.
 *
 * @property int $id
 * @property int $user_id
 * @property string $provider
 * @property string $token
 * @property string|null $platform
 * @property string|null $app_version
 * @property CarbonInterface|null $last_seen_at
 */
class DeviceToken extends Model
{
    protected $fillable = [
        'user_id',
        'provider',
        'token',
        'platform',
        'app_version',
        'last_seen_at',
    ];

    protected function casts(): array
    {
        return ['last_seen_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
