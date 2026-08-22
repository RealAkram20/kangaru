<?php

namespace Modules\Trips\Models;

use App\Concerns\BelongsToTenant;
use App\Support\Tenancy\TenantScope;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Clients\Models\ClientPlace;
use Modules\Trips\Enums\TripStopSource;
use Modules\Trips\Enums\TripStopStatus;

/**
 * One stop on one journey — evidence, not a plan (ADR-0045 §1).
 *
 * A route is a plan a client owns and edits; a stop is what a trip carried,
 * once, and it never changes meaningfully after the run. Every mutation goes
 * through `TripStopService`: the add (driver at a kerb, §4), and the
 * arrive/depart stamps that ride on the transitions §2 reuses. Nothing else
 * writes here.
 *
 * ## Tenancy: `TripEvent`'s pattern, for `TripEvent`'s reason
 *
 * `tenant_id` is copied from the trip at insert and is null on a walk-in
 * (ADR-0024 §1). `TenantScope` fails closed, so any relation query from a
 * driver's request — no tenant bound — would silently lose every row, and a
 * bound tenant would lose every walk-in's. `scopeForTrip` is the named
 * opt-out: the narrowing IS the authorization, because every query starts
 * from a single trip the caller already passed `TripPolicy` for.
 *
 * @property int $id
 * @property int|null $tenant_id
 * @property int $trip_id
 * @property int|null $client_place_id
 * @property int $sequence
 * @property string $label
 * @property float|null $latitude
 * @property float|null $longitude
 * @property TripStopSource $source
 * @property TripStopStatus $status
 * @property CarbonInterface|null $arrived_at
 * @property CarbonInterface|null $departed_at
 * @property string|null $skip_reason
 */
class TripStop extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'trip_id',
        'client_place_id',
        'sequence',
        'label',
        'latitude',
        'longitude',
        'source',
        'status',
        'arrived_at',
        'departed_at',
        'skip_reason',
    ];

    protected function casts(): array
    {
        return [
            // Float, not decimal-string — read straight into a map's
            // coordinate pair, same reasoning as `ClientPlace`.
            'latitude' => 'float',
            'longitude' => 'float',
            'sequence' => 'integer',
            'source' => TripStopSource::class,
            'status' => TripStopStatus::class,
            'arrived_at' => 'datetime',
            'departed_at' => 'datetime',
        ];
    }

    /**
     * The stops of one trip the caller has already been authorised for,
     * in run order. See the class docblock for why the tenant scope is
     * dropped here and must not be dropped ad hoc anywhere else.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeForTrip(Builder $query, Trip $trip): Builder
    {
        return $query
            ->withoutGlobalScope(TenantScope::class)
            ->where($this->getTable().'.trip_id', $trip->getKey())
            ->orderBy($this->getTable().'.sequence');
    }

    /** @return BelongsTo<Trip, $this> */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    /** @return BelongsTo<ClientPlace, $this> */
    public function clientPlace(): BelongsTo
    {
        return $this->belongsTo(ClientPlace::class);
    }
}
