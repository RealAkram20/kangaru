<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Trips\Enums\TripStopSource;
use Modules\Trips\Models\Trip;
use Modules\Trips\Requests\StoreTripStopRequest;
use Modules\Trips\Resources\TripStopResource;
use Modules\Trips\Services\TripStopService;

/**
 * Extending a live run (ADR-0045 §4).
 *
 * The one write surface for stops. The driver standing at a kerb appends the
 * next drop-off without waiting for anyone to tap approve; the deviation is
 * flagged (`unplanned_stop_count`), shown, and never billed — §4's posture,
 * and `distance_variance_flagged`'s before it. Pricing is untouched by
 * design (§3): distance and waiting already capture what a circuit costs.
 */
class TripStopController extends Controller
{
    public function __construct(private readonly TripStopService $stops) {}

    public function store(StoreTripStopRequest $request, Trip $trip): JsonResponse
    {
        $this->authorize('addStop', $trip);

        // A 409, not a 422: the request was well-formed, the trip has moved
        // on (or not started). §4 extends a *live* journey; a completed
        // trip's stops are evidence, and evidence does not grow afterwards.
        if (! in_array($trip->status, TripStopService::ACTIVE_STATUSES, true)) {
            return ApiResponse::error(
                ErrorCode::TRIP_NOT_ACTIVE,
                'Stops can only be added while the trip is running.',
                [],
                409,
            );
        }

        /** @var User $user */
        $user = $request->user();

        // Who is extending the run decides the flag (§4): the trip's own
        // driver is the unplanned case the client sees counted; an office
        // acting through `trips.transition.any` is the plan changing.
        $source = $trip->driver?->user_id === $user->id
            ? TripStopSource::ADDED_BY_DRIVER
            : TripStopSource::ADDED_BY_DISPATCH;

        $stop = $this->stops->add($trip, $request->validated(), $user, $source);

        return ApiResponse::success(new TripStopResource($stop), 'Stop added.', 201);
    }
}
