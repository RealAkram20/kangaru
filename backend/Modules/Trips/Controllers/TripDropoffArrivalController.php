<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Trips\Models\Trip;
use Modules\Trips\Resources\TripResource;
use Modules\Trips\Services\TripStopService;

/**
 * Reaching the destination the trip was agreed for, without ending the trip.
 *
 * ## Why this act exists at all
 *
 * Until extensions, arriving at the drop-off and finishing the trip were one
 * act: the driver tapped Complete at the kerb and there was nothing else to
 * say. An extension separates them — the passenger is set down where they
 * asked, and then asks to go somewhere else — so the platform needs a way to
 * record the first half on its own.
 *
 * ## Why it is not a `TripStatus`
 *
 * The state machine's graph is shared by every kind of work this platform
 * carries: corporate assignments, deliveries, self-drive. A new state would
 * have to be legislated for on all of them, and would appear in every screen
 * and report that switches on status, to describe something that only ever
 * happens on a trip somebody extended. `trips.dropoff_reached_at` is a fact
 * about one journey, which is what it is.
 *
 * ## Idempotent, and that is the point
 *
 * A driver who taps twice, or whose first tap was answered into a dead zone
 * and retried, must not move the timestamp. The first arrival is the true
 * one; a later write would quietly change which side of the boundary an
 * extension was added on, and that boundary decides where the driver's map
 * points.
 */
class TripDropoffArrivalController extends Controller
{
    /**
     * Marks the agreed drop-off as reached.
     *
     * Completing a trip does not require this first. A point-to-point trip
     * that nobody extends never calls it, and nothing about that trip
     * changes — which is every trip in the database today.
     */
    public function store(Request $request, Trip $trip): JsonResponse
    {
        $this->authorize('addStop', $trip);

        if (! in_array($trip->status, TripStopService::ACTIVE_STATUSES, true)) {
            return ApiResponse::error(
                ErrorCode::TRIP_NOT_ACTIVE,
                'A drop-off can only be marked while the trip is running.',
                [],
                409,
            );
        }

        if ($trip->dropoff_reached_at === null) {
            $trip->forceFill(['dropoff_reached_at' => now()])->save();
        }

        // `refresh()` rather than `fresh()`: it reloads this instance and
        // returns it, where `fresh()` returns a nullable new one and would
        // have the caller handle a row that cannot have vanished.
        return ApiResponse::success(
            new TripResource($trip->refresh()->load(['vehicle', 'driver'])),
            'Drop-off reached.',
        );
    }
}
