<?php

namespace Modules\Billing\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Exceptions\FinancialRecordImmutableException;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Modules\Billing\Enums\RoundingMode;

/**
 * One immutable priced revision of a rate card.
 *
 * AGENTS.md: "Rate cards are versioned and immutable once used. Editing
 * creates a new version; historical invoices keep their version reference.
 * This is what ends billing disputes."
 *
 * Enforced harder than "once used": a version is immutable from the moment
 * it is created. The only update this model permits is the one that stamps
 * `locked_at` the first time an invoice cites it. Everything else throws.
 *
 * That is deliberately stricter than the standard requires. A version that
 * can be edited right up until its first invoice has a window in which two
 * people can read different prices off the same version number, and the
 * dispute this design exists to end is precisely an argument about which
 * numbers were in force. Creating another version costs nothing.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $rate_card_id
 * @property int $version
 * @property CarbonInterface $effective_from
 * @property string $currency
 * @property RoundingMode $rounding_mode
 * @property int $free_waiting_minutes
 * @property string|null $night_starts_at
 * @property string|null $night_ends_at
 * @property int $night_multiplier_bp
 * @property CarbonInterface|null $locked_at
 */
class RateCardVersion extends Model
{
    use Auditable, BelongsToTenant;

    /**
     * Basis points representing "no multiplier". 10000 bp = 1.0x.
     *
     * Multipliers are integers because AGENTS.md forbids floats anywhere
     * near money, and a rate stored as 1.25 is a float by another name.
     */
    public const NO_MULTIPLIER_BP = 10_000;

    protected $fillable = [
        'tenant_id',
        'rate_card_id',
        'version',
        'effective_from',
        'currency',
        'rounding_mode',
        'free_waiting_minutes',
        'night_starts_at',
        'night_ends_at',
        'night_multiplier_bp',
        'created_by_user_id',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'effective_from' => 'date',
            'rounding_mode' => RoundingMode::class,
            'free_waiting_minutes' => 'integer',
            'night_multiplier_bp' => 'integer',
            'locked_at' => 'datetime',
        ];
    }

    public static function booted(): void
    {
        static::updating(function (self $version) {
            if ($version->isLockingUpdate()) {
                return;
            }

            throw new FinancialRecordImmutableException($version, 'edited');
        });

        static::deleting(function (self $version) {
            throw new FinancialRecordImmutableException($version, 'deleted');
        });
    }

    /**
     * True only for the single write that stamps `locked_at` on a version
     * that was not previously locked.
     *
     * `getDirty()` is safe to read here: Eloquent fires `updating` before
     * `updateTimestamps()` in `performUpdate()`, so `updated_at` is not yet
     * dirty and cannot mask what actually changed. (Verified against
     * Laravel 12 source — the opposite of the situation documented on
     * App\Models\AuditLog::diffForUpdate(), which runs on `updated`.)
     */
    private function isLockingUpdate(): bool
    {
        return array_keys($this->getDirty()) === ['locked_at']
            && $this->getOriginal('locked_at') === null;
    }

    public function isLocked(): bool
    {
        return $this->locked_at !== null;
    }

    /**
     * Stamps the version as used. Called by InvoiceService inside the
     * invoice transaction, so a version and the first invoice citing it
     * become permanent together or not at all.
     */
    public function lock(): void
    {
        if ($this->isLocked()) {
            return;
        }

        $this->locked_at = now();
        $this->save();
    }

    public function rateCard(): BelongsTo
    {
        return $this->belongsTo(RateCard::class);
    }

    public function rates(): HasMany
    {
        return $this->hasMany(RateCardRate::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * The rates for one vehicle category, or null when this version does
     * not price that category at all. Callers must treat null as a refusal
     * to invoice, never as "charge nothing".
     */
    public function rateFor(string $vehicleCategory): ?RateCardRate
    {
        return $this->rates->firstWhere('vehicle_category', $vehicleCategory);
    }

    public function hasNightRate(): bool
    {
        return $this->night_starts_at !== null
            && $this->night_ends_at !== null
            && $this->night_multiplier_bp !== self::NO_MULTIPLIER_BP;
    }
}
