<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Trips\Models\Trip;

/**
 * One movement in a driver's account (ADR-0029).
 *
 * Append-only by contract, not merely by habit: `$guarded` is empty for the
 * writer's convenience but nothing in this codebase updates or deletes an
 * entry, and a correction is a new `adjustment` that reverses an old row.
 * That is what makes the balance defensible to the person it belongs to.
 *
 * @property int $id
 * @property int $driver_id
 * @property int|null $trip_id
 * @property LedgerEntryKind $kind
 * @property int $amount_minor
 * @property string $currency
 * @property string $description
 */
class DriverLedgerEntry extends Model
{
    use Auditable;

    protected $fillable = [
        'driver_id',
        'trip_id',
        'kind',
        'amount_minor',
        'currency',
        'description',
        'created_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            'kind' => LedgerEntryKind::class,
            'amount_minor' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Driver, $this>
     */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * @return BelongsTo<Trip, $this>
     */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
