<?php

namespace Modules\Trips\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Trips\Jobs\RecordTripLocations;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripLocation;
use Modules\Trips\Requests\StoreTripLocationsRequest;
use Modules\Trips\Requests\TripRouteRequest;
use Modules\Trips\Resources\TripLocationResource;
use Modules\Trips\Services\RouteDistanceCalculator;

class TripLocationController extends Controller
{
    /**
     * Accepts a batch of GPS pings for a trip and queues them.
     *
     * Returns 202, not 201: the pings have been accepted and validated, but
     * nothing has been written yet — ADR-0003 puts a buffer and a batch
     * worker between this response and the database. Claiming 201 would
     * assert a row exists that does not.
     */
    public function store(StoreTripLocationsRequest $request, Trip $trip): JsonResponse
    {
        $this->authorize('recordLocations', $trip);

        $pings = $request->pings();

        RecordTripLocations::dispatch($trip->tenant_id, $trip->id, $pings);

        return ApiResponse::success(
            ['accepted' => count($pings)],
            'Locations accepted.',
            202,
        );
    }

    /**
     * The recorded route, for replay.
     *
     * Cursor-paginated: AGENTS.md reserves cursors for "large or
     * append-heavy lists (trips, GPS)", and this is the list that grows by
     * ~500M rows a year.
     */
    public function index(TripRouteRequest $request, Trip $trip): JsonResponse
    {
        $this->authorize('view', $trip);

        $paginator = TripLocation::query()
            ->where('trip_id', $trip->id)
            // Same ordering the distance calculation uses; `id` breaks ties
            // because DATETIME only resolves to the second.
            ->orderBy('recorded_at')
            ->orderBy('id')
            ->cursorPaginate($request->perPage());

        return ApiResponse::success(
            TripLocationResource::collection($paginator->getCollection()),
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // Recomputed from the trace rather than read off the trip:
                // this endpoint answers "what does the GPS say", and the
                // trip's stored figure is only written when it completes.
                'gps_distance_km' => app(RouteDistanceCalculator::class)->kilometresFor($trip->id),
            ],
        );
    }
}
