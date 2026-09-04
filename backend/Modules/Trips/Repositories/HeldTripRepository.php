<?php

namespace Modules\Trips\Repositories;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Modules\Trips\Distance\DistanceGrade;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Trips\Models\Trip;

/**
 * The trips whose distance is holding money up (ADR-0045 §2; the review queue
 * `docs/measured-distance-plan.md` Phase 3 asks for).
 *
 * ## What "held" means here, and why it is answered from the evidence row
 *
 * `DistanceGate` decides one trip at a time, and it asks the rate card version
 * that would price *that* trip — which means resolving a card, a date and a
 * tenant. Repeating that per row would be `RateCardResolver` reimplemented in
 * SQL, which is exactly the "one predicate in five places" ADR-0006 was
 * written about.
 *
 * So the queue reads `trip_distance_evidence.policy` — the policy the
 * resolution actually ran under, stored at the time. A trip is held when its
 * **latest** resolution is:
 *
 * - grade `C`, which is held under every policy; or
 * - grade `U` under a trace-priced policy, which is held because the contract
 *   asked to be billed on something that was not measured.
 *
 * …and nobody has cleared it. The one case this can disagree with the gate is
 * a card whose policy changed *after* a trip resolved and before it was
 * billed — the queue would list it under the old policy. Re-resolving the
 * trip (late pings, or `trips:replay-distance --commit`) corrects it, and the
 * gate is still the authority at the moment money moves.
 *
 * ## Scope
 *
 * `forActor` (ADR-0006), so a client's user sees their own held trips and
 * platform staff see every client's — the same rule the trips listing
 * follows. A walk-in trip has no tenant and so appears for platform staff
 * only, which is right: nobody is billed for it but the platform.
 */
class HeldTripRepository
{
    /**
     * @return Builder<Trip>
     */
    public function query(User $actor): Builder
    {
        return Trip::forActor($actor)
            ->with(['vehicle', 'driver'])
            ->when($actor->isPlatformLevel(), fn (Builder $query) => $query->with('tenant'))
            ->whereNotNull('distance_resolved_at')
            ->whereNull('distance_cleared_at')
            ->whereIn('distance_grade', [DistanceGrade::HELD->value, DistanceGrade::UNVERIFIED->value])
            // Grade U is only a hold where the contract prices the trace, and
            // the evidence row is the record of which policy decided. The
            // subquery is scope-free for the reason `RouteDistanceCalculator`
            // gives: it is keyed on the trip this row belongs to, and
            // `trip_distance_evidence` carries a nullable tenant that
            // `TenantScope` would fail closed on for every walk-in.
            ->where(function (Builder $query) {
                $query
                    ->where('distance_grade', DistanceGrade::HELD->value)
                    ->orWhere(fn (Builder $unverified) => $unverified
                        ->where('distance_grade', DistanceGrade::UNVERIFIED->value)
                        ->whereExists(fn ($exists) => $exists
                            ->from('trip_distance_evidence as e')
                            ->whereColumn('e.trip_id', 'trips.id')
                            ->where('e.policy', '!=', DistancePolicy::ODOMETER->value)
                            ->whereRaw('e.id = (select max(id) from trip_distance_evidence where trip_id = trips.id)')));
            })
            // Oldest first: a queue with an SLA is worked from the end that is
            // about to breach it, not from the newest thing that happened.
            ->orderBy('distance_resolved_at')
            ->orderBy('id');
    }

    /**
     * The same set, unordered and unloaded, for a count. Kept beside the
     * query so the badge on the navigation and the rows on the screen can
     * never disagree about what is held.
     */
    public function count(User $actor): int
    {
        // `query()` has already applied `forActor`, which is the whole of the
        // scoping — dropping the global scope again here would widen a
        // client's count to every tenant's.
        return $this->query($actor)->reorder()->count();
    }
}
