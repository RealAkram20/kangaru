<?php

namespace Modules\Fleet\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonInterface;
use Database\Factories\VehicleAllocationFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Vehicles\Models\Vehicle;

/**
 * A vehicle contracted to a corporate account for a period (ADR-0005).
 *
 * Centenary Bank's letter asks about "all vehicles **supplied to** the
 * Bank". That is this record. The old schema said it with
 * `vehicles.tenant_id`, which made the arrangement permanent, exclusive and
 * indistinguishable from ownership — a vehicle on hire to the Bank this
 * quarter and doing hailing work the next could not be expressed.
 *
 * The vehicle is Shanitah's; the allocation is the client's. So this is
 * `BelongsToTenant` and `Vehicle` deliberately is not — the two sit either
 * side of the line ADR-0005 draws, and that is the whole point of
 * separating them.
 *
 * The first thing to live in Modules/Fleet, which has been empty
 * scaffolding since the project started.
 *
 * Since ADR-0009 an allocation also says whether it *excludes* anybody.
 * `exclusive` defaults to false: the vehicle ranks first for that client and
 * stays available to everyone else. True means it may be dispatched only on
 * that tenant's trips for the period — a per-contract opt-in, not a property
 * of allocation itself.
 *
 * @property int $id
 * @property int $vehicle_id
 * @property int $tenant_id
 * @property CarbonInterface $starts_on
 * @property CarbonInterface|null $ends_on
 * @property bool $exclusive
 */
class VehicleAllocation extends Model
{
    use Auditable, BelongsToTenant;

    /** @use HasFactory<VehicleAllocationFactory> */
    use HasFactory;

    /**
     * Explicit for the same reason `Vehicle` is: Laravel's resolver only
     * guesses correctly for models under App\Models, and from Modules\ it
     * would look for Database\Factories\Modules\Fleet\Models\...
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return VehicleAllocationFactory::new();
    }

    protected $fillable = [
        'vehicle_id',
        'tenant_id',
        'starts_on',
        'ends_on',
        'exclusive',
        'notes',
        'created_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date',
            'ends_on' => 'date',
            'exclusive' => 'boolean',
        ];
    }

    /** @return BelongsTo<Vehicle, $this> */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** @return BelongsTo<User, $this> */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    /**
     * Allocations in force on a given day.
     *
     * A null `ends_on` is open-ended, which is the common case — the Bank's
     * contract states no end date. Written as "started on or before, and
     * either has not ended or ends on or after", so a contract's last day
     * is still one of its days.
     *
     * @param  Builder<VehicleAllocation>  $query
     * @return Builder<VehicleAllocation>
     */
    public function scopeInForceOn(Builder $query, ?CarbonInterface $on = null): Builder
    {
        $day = ($on ?? now())->toDateString();

        return $query
            ->whereDate('starts_on', '<=', $day)
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhereDate('ends_on', '>=', $day));
    }

    /**
     * Allocations whose period intersects the given one, by at least a day.
     *
     * Two closed ranges overlap when each starts on or before the other
     * ends; a null `ends_on` is open-ended and so ends after everything.
     * Written from that pair of conditions rather than by enumerating the
     * containment cases, because the enumeration is where the missed case
     * hides.
     *
     * **Boundaries are inclusive, and deliberately so.** `scopeInForceOn`
     * already decides that a contract's final day is one of its days, so a
     * contract ending on the 10th and another starting on the 10th share
     * that day and overlap. Treating them as adjacent would mean one vehicle
     * owed to two clients on the same morning — which is precisely the thing
     * `exclusive` exists to prevent, and the off-by-one that would let it
     * through unnoticed.
     *
     * This is the predicate ADR-0009's overlap rule is written in. It is
     * only a *query*, not the rule: the rule needs a lock, and lives in
     * `Modules\Fleet\Services\AllocationService`.
     *
     * @param  Builder<VehicleAllocation>  $query
     * @return Builder<VehicleAllocation>
     */
    public function scopeOverlapping(
        Builder $query,
        CarbonInterface $startsOn,
        ?CarbonInterface $endsOn = null,
    ): Builder {
        $start = $startsOn->toDateString();
        // Resolved before the closure: inside one, `$endsOn` is only known to
        // PHPStan as nullable however the condition is written.
        $end = $endsOn?->toDateString();

        return $query
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhereDate('ends_on', '>=', $start))
            ->when($end !== null, fn ($q) => $q->whereDate('starts_on', '<=', $end));
    }
}
