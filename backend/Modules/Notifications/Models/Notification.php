<?php

namespace Modules\Notifications\Models;

use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Notifications\Enums\NotificationType;

/**
 * One delivered in-app notification.
 *
 * ## Frozen once delivered, except for being read
 *
 * A notification is a record of what somebody was told. Re-rendering it
 * later against changed data would rewrite history — a booking rejected
 * for one reason would, after an edit, appear to have been rejected for
 * another, and the recipient would have no way to tell. So every update is
 * refused except one that touches `read_at` and nothing else.
 *
 * That is narrower than the Billing models' outright refusal, because read
 * state genuinely is mutable and belongs on this row: it is per-recipient,
 * and a separate reads table would be a join for a boolean.
 *
 * Written exclusively by TenantDatabaseChannel.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $user_id
 * @property NotificationType $type
 * @property string $subject
 * @property string $body
 * @property string|null $url
 * @property array<string, mixed>|null $context
 * @property CarbonInterface|null $read_at
 */
class Notification extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'user_id',
        'type',
        'subject',
        'body',
        'url',
        'context',
        'read_at',
    ];

    protected function casts(): array
    {
        return [
            'type' => NotificationType::class,
            'context' => 'array',
            'read_at' => 'datetime',
        ];
    }

    public static function booted(): void
    {
        static::updating(function (self $notification) {
            // getDirty() rather than isDirty('read_at'): the question is not
            // "did read_at change" but "did anything else". A save that
            // marked it read *and* rewrote the body would pass the former.
            $changed = array_keys($notification->getDirty());

            if (array_diff($changed, ['read_at', 'updated_at']) !== []) {
                throw new NotificationImmutableException($notification, $changed);
            }
        });
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function isRead(): bool
    {
        return $this->read_at !== null;
    }

    /**
     * Marking an already-read notification read again is a no-op rather
     * than a re-stamp: the useful fact is when it was *first* seen, and a
     * client that re-sends on every render would otherwise keep moving it.
     */
    public function markRead(): void
    {
        if ($this->read_at === null) {
            $this->read_at = now();
            $this->save();
        }
    }

    /**
     * Only ever this user's.
     *
     * A notification is addressed to one person. Even a tenant admin has no
     * business reading a colleague's, so there is no "all notifications"
     * query anywhere in the module for a policy to have to forbid.
     *
     * `forActor` before the `user_id` filter, since ADR-0007: platform staff
     * belong to no tenant, so the global scope failed closed and their inbox
     * was empty however much mail they had. Dropping the tenant scope for
     * them grants nothing here, because `user_id` is the narrower predicate
     * and it is applied unconditionally — a platform user reads their own
     * rows and no others, exactly like everybody else. This is the one place
     * in the codebase where `forActor` is a convenience rather than a
     * widening, and it is safe for that reason and only that reason.
     *
     * @param  Builder<Notification>  $query
     * @return Builder<Notification>
     */
    public function scopeFor(Builder $query, User $user): Builder
    {
        return $query->forActor($user)->where('user_id', $user->id);
    }

    /**
     * @param  Builder<Notification>  $query
     * @return Builder<Notification>
     */
    public function scopeUnread(Builder $query): Builder
    {
        return $query->whereNull('read_at');
    }
}
