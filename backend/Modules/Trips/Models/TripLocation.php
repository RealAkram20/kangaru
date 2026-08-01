<?php

namespace Modules\Trips\Models;

use App\Concerns\BelongsToTenant;
use App\Exceptions\TripEventImmutableException;
use Carbon\CarbonInterface;
use Database\Factories\TripLocationFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Vehicles\Models\Vehicle;

/**
 * One GPS ping on a trip's route (ADR-0003).
 *
 * Append-only, like `trip_events` and for the same reason: the route is
 * evidence. It backs the distance a client is billed for and the
 * odometer reconciliation that flags a driver's reading as suspect, and a
 * trace somebody can edit afterwards is worth nothing in either argument.
 *
 * Bulk ingestion deliberately does **not** go through this model —
 * Modules\Trips\Services\TripRouteRecorder writes through the query builder
 * so a batch of 500 pings is one INSERT rather than 500 model saves. The
 * guards below cover the other path: code that loads a ping and tries to
 * change it.
 *
 * The table is partitioned by month and therefore carries no foreign keys
 * (InnoDB refuses them on partitioned tables — see the migration). Nothing
 * writes `tenant_id`/`trip_id` except from an already-loaded Trip.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $trip_id
 * @property string $latitude
 * @property string $longitude
 * @property string|null $speed_kph
 * @property int|null $heading_degrees
 * @property string|null $accuracy_metres
 * @property CarbonInterface $recorded_at
 */
class TripLocation extends Model
{
    /** @use HasFactory<TripLocationFactory> */
    use BelongsToTenant, HasFactory;

    /**
     * No `updated_at` column exists — this table is append-only, and at
     * ~500M rows a year a second timestamp nobody reads is not free.
     */
    const UPDATED_AT = null;

    protected $table = 'trip_locations';

    protected $fillable = [
        'tenant_id',
        'trip_id',
        'latitude',
        'longitude',
        'speed_kph',
        'heading_degrees',
        'accuracy_metres',
        'recorded_at',
    ];

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return TripLocationFactory::new();
    }

    protected function casts(): array
    {
        return [
            // Kept as decimal strings rather than floats: these are the
            // inputs to a billed distance, and AGENTS.md's objection to
            // floats in money maths applies just as well to the figure the
            // money is derived from.
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'speed_kph' => 'decimal:2',
            'accuracy_metres' => 'decimal:2',
            'heading_degrees' => 'integer',
            'recorded_at' => 'datetime',
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

    /** @return BelongsTo<Trip, $this> */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }
}
