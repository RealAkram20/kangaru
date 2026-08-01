<?php

namespace Modules\Trips\Models;

use App\Concerns\BelongsToTenant;
use App\Exceptions\TripEventImmutableException;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Trips\Enums\TripStatus;

/**
 * Append-only trip timeline (AGENTS.md: "Every transition is timestamped
 * in an append-only trip_events table"). Written exclusively via the
 * static record() factory — never constructed/saved directly elsewhere.
 * Structurally mirrors App\Models\AuditLog.
 */
class TripEvent extends Model
{
    use BelongsToTenant;

    /**
     * No updated_at column exists — this table is append-only.
     */
    const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'trip_id',
        'from_status',
        'to_status',
        'user_id',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'from_status' => TripStatus::class,
            'to_status' => TripStatus::class,
        ];
    }

    public static function booted(): void
    {
        static::updating(function () {
            throw new TripEventImmutableException;
        });

        static::deleting(function () {
            throw new TripEventImmutableException;
        });
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function record(Trip $trip, ?TripStatus $from, TripStatus $to, ?User $actor, ?string $notes): self
    {
        return static::create([
            'tenant_id' => $trip->tenant_id,
            'trip_id' => $trip->id,
            'from_status' => $from,
            'to_status' => $to,
            'user_id' => $actor?->id,
            'notes' => $notes,
        ]);
    }
}
