<?php

namespace Modules\Fleet\Models;

use App\Concerns\Auditable;
use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
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
 * @property int $id
 * @property int $vehicle_id
 * @property int $tenant_id
 * @property CarbonInterface $starts_on
 * @property CarbonInterface|null $ends_on
 */
class VehicleAllocation extends Model
{
    use Auditable, BelongsToTenant;

    protected $fillable = [
        'vehicle_id',
        'tenant_id',
        'starts_on',
        'ends_on',
        'notes',
        'created_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date',
            'ends_on' => 'date',
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
}
