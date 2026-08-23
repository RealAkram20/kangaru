<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\PlaceSuggestionService;
use Modules\Trips\Services\TripStopService;

/**
 * Geocoder suggestions for the add-a-drop-off search (ADR-0045 §10,
 * follow-up decided by the owner 2026-08-22).
 *
 * The register endpoint beside this one answers from the client's own pins
 * and stays authoritative — the app lists it first. This one answers the
 * question the register cannot: a site nobody has pinned yet, typed by a
 * technician mid-circuit. Same policy, same active-trip gate, same driver,
 * same window; what differs is where the answer comes from, and
 * `PlaceSuggestionService` documents why that is the server's business and
 * not the handset's.
 *
 * `q` is required here where the candidates endpoint accepts its absence:
 * an empty register query usefully lists the estate, but an empty geocoder
 * query has no honest answer and would spend a public service's goodwill
 * saying so. Three characters minimum, the console's own floor.
 */
class TripPlaceSuggestionController extends Controller
{
    public function index(Request $request, Trip $trip, PlaceSuggestionService $suggestions): JsonResponse
    {
        $this->authorize('viewStopCandidates', $trip);

        if (! in_array($trip->status, TripStopService::ACTIVE_STATUSES, true)) {
            return ApiResponse::error(
                ErrorCode::TRIP_NOT_ACTIVE,
                'Stops can only be added while the trip is running.',
                [],
                409,
            );
        }

        $validated = $request->validate([
            'q' => ['required', 'string', 'min:3', 'max:80'],
        ]);

        return ApiResponse::success($suggestions->search($validated['q']));
    }
}
