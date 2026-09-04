<?php

namespace Modules\Trips\Models;

use App\Concerns\BelongsToTenant;
use App\Support\Tenancy\TenantScope;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Clients\Models\ClientPlace;
use Modules\Trips\Enums\TripStopKind;
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
 * @property TripStopKind $kind
 * @property TripStopSource $source
 * @property int|null $added_by_user_id
 * @property TripStopStatus $status
 * @property CarbonInterface|null $arrived_at
 * @property CarbonInterface|null $departed_at
 * @property CarbonInterface|null $accepted_at
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
        'kind',
        'source',
        'added_by_user_id',
        'status',
        'arrived_at',
        'departed_at',
        'accepted_at',
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
            'kind' => TripStopKind::class,
            'source' => TripStopSource::class,
            'status' => TripStopStatus::class,
            'arrived_at' => 'datetime',
            'departed_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }

    /**
     * The extensions this trip is actually committed to, in run order.
     *
     * **Accepted only, and that is the whole point.** A `PROPOSED` row is a
     * passenger's request the driver has not agreed to; routing through it
     * would put an unagreed leg into the reference route and therefore into
     * the fare. A `SKIPPED` one was declined or never reached.
     *
     * Every caller that asks "where is this journey actually going" — the
     * reference route, the fare, the completion rule — goes through here, so
     * that the answer cannot drift between them.
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeAcceptedExtensions(Builder $query, Trip $trip): Builder
    {
        return $query
            ->forTrip($trip)
            ->where($this->getTable().'.kind', TripStopKind::EXTENSION)
            ->whereIn($this->getTable().'.status', [
                TripStopStatus::PENDING,
                TripStopStatus::ARRIVED,
                TripStopStatus::DONE,
            ]);
    }

    /** Whether this row moves the end of the journey rather than pausing on it. */
    public function isExtension(): bool
    {
        return $this->kind === TripStopKind::EXTENSION;
    }

    /** A passenger's request the driver has not yet agreed to. */
    public function isAwaitingDriver(): bool
    {
        return $this->status === TripStopStatus::PROPOSED;
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
