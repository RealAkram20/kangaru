<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use App\Support\Database\SearchTerm;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Clients\Models\ClientPlace;
use Modules\Trips\Models\Trip;
use Modules\Trips\Resources\TripStopCandidateResource;
use Modules\Trips\Services\TripStopService;

/**
 * The add-a-drop-off search (ADR-0045 §10).
 *
 * What a bank's crew calls "the next ATM" is a row in the client's own place
 * register — authoritative in a way no public geocoder is for an estate the
 * client pinned themselves. §10 bounds the release: one driver, the client
 * whose trip they are currently driving, while the run is live, and none at
 * all between jobs. The full estate in service order is a cash-logistics
 * document (`docs/security-gate.md` F2); this serves name, address and pin,
 * capped, and nothing an invoice or an audit would miss.
 *
 * A walk-in trip has no tenant and therefore no register: the ordinary
 * answer is an empty list, and the app's free-text row carries the rest.
 */
class TripStopCandidateController extends Controller
{
    public function index(Request $request, Trip $trip): JsonResponse
    {
        $this->authorize('viewStopCandidates', $trip);

        // The same gate, code and sentence as adding a stop: §10's bound is
        // "currently driving", and a search that answered after the run
        // would be the estate leaking out of its window.
        if (! in_array($trip->status, TripStopService::ACTIVE_STATUSES, true)) {
            return ApiResponse::error(
                ErrorCode::TRIP_NOT_ACTIVE,
                'Stops can only be added while the trip is running.',
                [],
                409,
            );
        }

        $validated = $request->validate([
            'q' => ['nullable', 'string', 'max:80'],
        ]);

        if ($trip->tenant_id === null) {
            return ApiResponse::success(TripStopCandidateResource::collection(collect()));
        }

        // Past the tenant scope, explicitly: the caller is a driver with no
        // tenant bound, and `TenantScope` failing closed would blank the
        // search. The `tenant_id` filter *is* the isolation — the trip's
        // client and nobody else's — with the soft-delete guard restated
        // because `withoutGlobalScopes` drops that scope too.
        $places = ClientPlace::query()
            ->withoutGlobalScopes()
            ->whereNull('deleted_at')
            ->where('tenant_id', $trip->tenant_id)
            ->active()
            ->when(isset($validated['q']) && $validated['q'] !== '', function ($query) use ($validated) {
                $term = SearchTerm::contains($validated['q']);

                $query->where(fn ($match) => $match
                    ->where('name', 'like', $term)
                    ->orWhere('address', 'like', $term));
            })
            ->orderBy('name')
            // A cap, not a page: a handset search wants the best dozen, and
            // a longer list on a cradled phone is scrolling, not choosing.
            ->limit(12)
            ->get();

        return ApiResponse::success(TripStopCandidateResource::collection($places));
    }
}
