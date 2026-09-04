<?php

namespace Modules\Notifications\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Cache;
use Modules\Notifications\Enums\NotificationType;

/**
 * A type of email this deployment has switched off, platform wide.
 *
 * A row means off. No row means on. See the migration for why the sparse shape
 * is right, and for why this is a different switch from `MailPreference`.
 *
 * @property int $id
 * @property NotificationType $type
 * @property int|null $disabled_by
 */
class MailToggle extends Model
{
    private const CACHE_KEY = 'mail.toggles.disabled';

    protected $fillable = ['type', 'disabled_by'];

    protected function casts(): array
    {
        return ['type' => NotificationType::class];
    }

    /**
     * Whether the platform sends this type at all.
     *
     * ## Cached forever, forgotten on write
     *
     * Read on every single send, including inside a digest sweep that touches
     * hundreds of recipients in a row, and the answer changes only when an
     * administrator moves a switch. The same shape `SettingsService` uses, for
     * the same reason, and the same discipline applies: **every write path
     * goes through `disable()` and `enable()`**, because a raw insert would
     * leave the cache serving the old answer indefinitely.
     *
     * ## Required types answer true without touching the table
     *
     * Not an optimisation. It means a row written while a type was optional
     * cannot silence it after it becomes required, and it means the guard
     * cannot be defeated by writing straight to the table.
     */
    public static function allows(NotificationType $type): bool
    {
        if ($type->mailIsRequired()) {
            return true;
        }

        return ! in_array($type->value, static::disabledTypes(), true);
    }

    /**
     * @return array<int, string>
     */
    public static function disabledTypes(): array
    {
        return Cache::rememberForever(
            self::CACHE_KEY,
            /*
             * `->value`, and it is not decoration.
             *
             * `pluck('type')` runs through this model's cast, so it returns
             * `NotificationType` **instances**, not strings. The first version
             * of this compared `$type->value` against that array with
             * `in_array(..., true)`, which is a string against a list of
             * objects: never equal, so `allows()` answered true for
             * everything and the switch silently did nothing.
             *
             * It failed in exactly the way that is hardest to notice from the
             * outside — the endpoint answered 200, the row was written, the
             * screen would have drawn the switch in the off position, and the
             * emails kept going out.
             */
            fn () => static::query()
                ->pluck('type')
                ->map(fn (NotificationType|string $type) => $type instanceof NotificationType ? $type->value : $type)
                ->all(),
        );
    }

    public static function disable(NotificationType $type, ?User $by = null): void
    {
        static::query()->updateOrCreate(['type' => $type->value], ['disabled_by' => $by?->id]);

        Cache::forget(self::CACHE_KEY);
    }

    public static function enable(NotificationType $type): void
    {
        static::query()->where('type', $type->value)->delete();

        Cache::forget(self::CACHE_KEY);
    }

    /** @return BelongsTo<User, $this> */
    public function disabledBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'disabled_by');
    }
}
