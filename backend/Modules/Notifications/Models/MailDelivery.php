<?php

namespace Modules\Notifications\Models;

use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The record of one email the platform tried to send.
 *
 * ## Written twice and never again
 *
 * `queued()` writes the row before the transport is touched. `markSent()` or
 * `markFailed()` closes it. Nothing else may write, and `booted()` refuses
 * anything that tries — including a second attempt to close a row that is
 * already closed, because "sent, then failed" is not a thing that can happen
 * and a row that says so is worse than no row.
 *
 * The order matters and is not an accident. Writing the row *first* means a
 * worker killed mid-send leaves a `queued` row rather than nothing, so the
 * gap is visible. A row written after a successful send would make every
 * crash look like an email that was never attempted.
 *
 * ## Deliberately not tenant-scoped by a global scope
 *
 * `tenant_id` is here and populated, but `BelongsToTenant` is not used.
 * Reading this table is head office's and the fleet's job, through
 * explicitly-scoped queries, and a global scope would silently empty it
 * inside a queue worker where no tenant is bound. That is the same trap
 * `TenantDatabaseChannel` documents, arrived at from the other side.
 *
 * @property int $id
 * @property int|null $user_id
 * @property int|null $tenant_id
 * @property int|null $operator_id
 * @property string $recipient
 * @property string $type
 * @property string $subject
 * @property string $status
 * @property string|null $error
 * @property int $attempts
 * @property CarbonInterface|null $sent_at
 */
class MailDelivery extends Model
{
    public const QUEUED = 'queued';

    public const SENT = 'sent';

    public const FAILED = 'failed';

    protected $fillable = [
        'user_id',
        'tenant_id',
        'operator_id',
        'recipient',
        'type',
        'subject',
        'status',
        'error',
        'attempts',
        'sent_at',
    ];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'sent_at' => 'datetime',
        ];
    }

    public static function booted(): void
    {
        static::updating(function (self $delivery) {
            $changed = array_diff(array_keys($delivery->getDirty()), ['updated_at']);

            // Only the closing write is allowed, and only from queued.
            $closing = ['status', 'error', 'attempts', 'sent_at'];

            if (array_diff($changed, $closing) !== [] || $delivery->getOriginal('status') !== self::QUEUED) {
                throw new MailDeliveryImmutableException($delivery, $changed);
            }
        });

        static::deleting(function (self $delivery) {
            throw new MailDeliveryImmutableException($delivery, ['deleted']);
        });
    }

    /**
     * The address a delivery went to, lowercased.
     *
     * Support searches by whatever the person on the phone reads out, and
     * they will not match the casing on file. Normalising on write rather
     * than making every reader remember to.
     */
    public function setRecipientAttribute(string $value): void
    {
        $this->attributes['recipient'] = mb_strtolower(trim($value));
    }

    /** @param  Builder<MailDelivery>  $query */
    public function scopeFailed(Builder $query): void
    {
        $query->where('status', self::FAILED);
    }

    /**
     * Consecutive failures at the tail of the log, newest first.
     *
     * This is what H5 in the mail plan watches. Three in a row is a mail
     * server that has stopped working rather than one bad address, and the
     * distinction is the whole point: a single failure is a typo in somebody's
     * email and alerting on it trains everyone to ignore the alert.
     */
    public static function consecutiveFailures(int $limit = 10): int
    {
        $recent = static::query()
            ->whereIn('status', [self::SENT, self::FAILED])
            ->latest('id')
            ->limit($limit)
            ->pluck('status');

        $run = 0;

        foreach ($recent as $status) {
            if ($status !== self::FAILED) {
                break;
            }

            $run++;
        }

        return $run;
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

    /** @return BelongsTo<Operator, $this> */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(Operator::class);
    }
}
