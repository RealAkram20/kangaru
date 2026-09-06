<?php

namespace Modules\Trips\Models;

use App\Concerns\BelongsToTenant;
use App\Exceptions\TripEventImmutableException;
use App\Support\Tenancy\TenantScope;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Trips\Distance\DistanceGrade;
use Modules\Trips\Distance\DistancePolicy;

/**
 * One resolution of one trip's distance — every witness, every threshold,
 * and the decision (ADR-0045; see the migration for the columns' meaning).
 *
 * Append-only, like `TripEvent` and `TripLocation`, and guarded the same
 * way: this is the evidence behind a figure that is invoiced and paid, and
 * evidence that can be edited afterwards is worth nothing in a dispute. A
 * trip resolved again gets a second row; `Trip::latestDistanceEvidence()`
 * is how the current one is read.
 *
 * `tenant_id` is nullable (walk-ins belong to the platform) and reads go
 * through `scopeForTrip` for the reason `TripEvent::scopeForTrip` sets out
 * at length: `TenantScope` fails closed on a null tenant, so a relation
 * query through a walk-in trip would silently return nothing.
 *
 * @property int $id
 * @property int|null $tenant_id
 * @property int $trip_id
 * @property CarbonInterface $resolved_at
 * @property DistancePolicy $policy
 * @property DistanceGrade $grade
 * @property string $billed_km
 * @property string $reason
 * @property string|null $odometer_km
 * @property string|null $gps_km
 * @property string|null $matched_km
 * @property string|null $inferred_km
 * @property string|null $haversine_km
 * @property string|null $route_km
 * @property string|null $reference_source
 * @property string|null $coverage_percent
 * @property string|null $inferred_share_percent
 * @property int $pings_total
 * @property int $pings_kept
 * @property int $gaps_routed
 * @property array<string, int> $dropped
 * @property string|null $provider
 * @property string|null $matched_polyline
 * @property array<string, mixed> $thresholds
 */
class DistanceEvidence extends Model
{
    use BelongsToTenant;

    /** No updated_at column exists — this table is append-only. */
    const UPDATED_AT = null;

    protected $table = 'trip_distance_evidence';

    protected $fillable = [
        'tenant_id',
        'trip_id',
        'resolved_at',
        'policy',
        'grade',
        'billed_km',
        'reason',
        'odometer_km',
        'gps_km',
        'matched_km',
        'inferred_km',
        'haversine_km',
        'route_km',
        'reference_source',
        'coverage_percent',
        'inferred_share_percent',
        'pings_total',
        'pings_kept',
        'gaps_routed',
        'dropped',
        'provider',
        'matched_polyline',
        'thresholds',
    ];

    protected function casts(): array
    {
        return [
            'resolved_at' => 'datetime',
            'policy' => DistancePolicy::class,
            'grade' => DistanceGrade::class,
            'billed_km' => 'decimal:2',
            'odometer_km' => 'decimal:2',
            'gps_km' => 'decimal:2',
            'matched_km' => 'decimal:2',
            'inferred_km' => 'decimal:2',
            'haversine_km' => 'decimal:2',
            'route_km' => 'decimal:2',
            'coverage_percent' => 'decimal:2',
            'inferred_share_percent' => 'decimal:2',
            'pings_total' => 'integer',
            'pings_kept' => 'integer',
            'gaps_routed' => 'integer',
            'dropped' => 'array',
            'thresholds' => 'array',
        ];
    }

    /**
     * Every resolution of one trip the caller has already been authorised
     * for, newest first. The narrowing is the authorisation — see
     * `TripEvent::scopeForTrip`.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeForTrip(Builder $query, Trip $trip): Builder
    {
        return $query
            ->withoutGlobalScope(TenantScope::class)
            ->where($this->getTable().'.trip_id', $trip->getKey())
            ->orderByDesc('resolved_at')
            ->orderByDesc('id');
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
