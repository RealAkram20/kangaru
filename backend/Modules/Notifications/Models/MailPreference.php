<?php

namespace Modules\Notifications\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Notifications\Enums\NotificationType;

/**
 * A user has switched one type of email off.
 *
 * A row means off. No row means on. See the migration for why the sparse
 * shape is the correct one rather than a row per user per type.
 *
 * @property int $id
 * @property int $user_id
 * @property NotificationType $type
 */
class MailPreference extends Model
{
    protected $fillable = ['user_id', 'type'];

    protected function casts(): array
    {
        return ['type' => NotificationType::class];
    }

    /**
     * Whether this user still wants this email.
     *
     * Required types answer true without touching the table. That is not an
     * optimisation: it means a stale row for a type that has since *become*
     * required cannot silence a password reset. Requiredness is decided by
     * the enum at read time, never by what somebody stored last year.
     */
    public static function allows(User $user, NotificationType $type): bool
    {
        if ($type->mailIsRequired()) {
            return true;
        }

        return ! static::query()
            ->where('user_id', $user->id)
            ->where('type', $type->value)
            ->exists();
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
