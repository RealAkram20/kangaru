<?php

namespace Modules\Trips\Controllers;

use App\Enums\Permission;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Resources\LivePositionResource;
use Modules\Trips\Support\LivePositionStore;

/**
 * Where the fleet is right now (ADR-0019) — the read the live map was
 * missing, and the reason `Modules/Trips/README.md` said "there is no live
 * map".
 *
 * ## Scoped through trips, not through positions
 *
 * A position is only ever meaningful as "this vehicle, on this trip", and a
 * trip already knows whose it is. So visibility is resolved by asking which
 * trips the caller may see — tenant scope and the `trips.view.all`
 * predicate, exactly as `TripController::index` does — and the positions
 * follow from the vehicles on them.
 *
 * The alternative, filtering `live_positions.tenant_id` directly, would be
 * a second copy of that predicate. When the two drifted, the failure would
 * be a client watching another client's vehicle move across a map — the
 * worst-shaped bug this platform can have (ADR-0001).
 *
 * ## Only vehicles actually working
 *
 * The query is confined to trips in an occupying status. A vehicle whose
 * last trip finished yesterday still has a row in `live_positions`; showing
 * it would put a marker on a map for a van sitting in the yard, and a
 * dispatcher would route work to it.
 */
class LivePositionController extends Controller
{
    public function __construct(private readonly LivePositionStore $positions) {}

    public function index(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        // `forActor`, not `query()` — the ADR-0006 entry point. Platform
        // staff belong to no tenant, so the plain tenant scope returns them
        // nothing; this was written as `Trip::query()` first and a platform
        // dispatcher saw an empty map while a corporate admin saw their own
        // vehicles, which is the failure mode that looks like "no data"
        // rather than "wrong query".
        $trips = Trip::forActor($user)
            ->whereIn('status', TripStatus::occupyingValues())
            ->when(
                ! $user->hasPermission(Permission::TRIPS_VIEW_ALL),
                fn ($query) => $query->where(function ($scoped) use ($user) {
                    $scoped
                        ->whereHas('driver', fn ($q) => $q->where('user_id', $user->id))
                        ->orWhereHas('booking', fn ($q) => $q->where('requested_by_user_id', $user->id));
                }),
            )
            // Platform readers narrowing to one client, as on every other
            // cross-client listing (ADR-0006).
            ->when(
                $request->filled('tenant_id') && $user->isPlatformLevel(),
                fn ($q) => $q->where('tenant_id', $request->integer('tenant_id')),
            )
            ->get(['id', 'vehicle_id']);

        if ($trips->isEmpty()) {
            return ApiResponse::success([], 'Nothing is moving.');
        }

        $vehicleIds = $trips->pluck('vehicle_id')->map(fn ($id) => (int) $id)->all();
        $tripIds = $trips->pluck('id')->map(fn ($id) => (int) $id)->flip();

        $positions = $this->positions->all($vehicleIds)
            // A vehicle reassigned to a new trip keeps one row, so its
            // stored `trip_id` is the authority on which trip the position
            // belongs to. Without this check a caller who may see the
            // vehicle's *previous* trip would read its current one.
            ->filter(fn ($position) => $tripIds->has($position->tripId))
            ->values();

        return ApiResponse::success(LivePositionResource::collection($positions));
    }
}
