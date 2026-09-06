<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Trips\Distance\DistanceClearanceService;
use Modules\Trips\Distance\DistanceNotHeldException;
use Modules\Trips\Models\DistanceEvidence;
use Modules\Trips\Models\Trip;
use Modules\Trips\Requests\ClearTripDistanceRequest;
use Modules\Trips\Resources\DistanceEvidenceResource;
use Modules\Trips\Resources\TripResource;

/**
 * A trip's distance evidence, and the one act the review queue performs on
 * it (ADR-0045 §2).
 */
class TripDistanceController extends Controller
{
    public function __construct(private readonly DistanceClearanceService $clearance) {}

    /**
     * Every resolution of this trip, newest first — the console's evidence
     * panel. `DistanceEvidence::forTrip()` drops the tenant scope so a
     * walk-in's rows are readable at all; the `view` policy is therefore the
     * whole guard, as it is for the timeline.
     */
    public function index(Trip $trip): JsonResponse
    {
        $this->authorize('view', $trip);

        $rows = DistanceEvidence::query()->forTrip($trip)->limit(50)->get();

        return ApiResponse::success(
            DistanceEvidenceResource::collection($rows),
            $rows->isEmpty() ? 'This trip has not been resolved yet.' : 'Distance evidence retrieved.',
        );
    }

    /**
     * Lift a hold. Finance's act — `trips.transition.finance`, the same
     * permission that closes and disputes a trip — with a reason, audited.
     */
    public function clear(ClearTripDistanceRequest $request, Trip $trip): JsonResponse
    {
        $this->authorize('clearDistance', $trip);

        /** @var User $user */
        $user = $request->user();

        try {
            $trip = $this->clearance->clear($trip, $user, $request->reason());
        } catch (DistanceNotHeldException $e) {
            return ApiResponse::error(ErrorCode::TRIP_DISTANCE_NOT_HELD, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            new TripResource($trip->fresh(['vehicle', 'driver', 'booking'])),
            'Distance cleared. The trip may now be billed.',
        );
    }
}
