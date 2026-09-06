<?php

namespace Modules\Trips\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Trips\Resources\TripEventResource;

class TripEventController extends Controller
{
    public function index(Trip $trip): JsonResponse
    {
        /*
          The whole of what guards this endpoint, and a mutation proved it was
          untested. `TripEvent::forTrip()` below drops the tenant scope so a
          walk-in's timeline is readable at all — so for two platform-level users
          (every driver is one) this policy check is the only thing between one
          driver and another's rows. `resolveRouteBinding` lets a platform-level
          user resolve any trip by id; the policy is what refuses them.
        */
        $this->authorize('view', $trip);

        // `TripEvent::forTrip()` rather than `$trip->events()`, and the
        // difference is a bug that shipped: the relation query carries
        // `TenantScope`, which fails closed, so **every walk-in trip's timeline
        // came back empty** — the only trips a driver actually does. The scope
        // is documented on that method along with the one place still affected.
        $paginator = TripEvent::query()
            ->forTrip($trip)
            // Loaded whole rather than as a column list.
            //
            // This used to enumerate exactly the columns UserResource read,
            // which made the two silently coupled: adding `status` to the
            // resource turned every timeline request into a 500, because
            // the column it now dereferences was never selected. The
            // failure surfaced in a test about chronological ordering,
            // nowhere near either change.
            //
            // Nothing sensitive rides along — `password` and
            // `remember_token` are in User::$hidden, and UserResource
            // decides the output either way. The saving was a few columns
            // on a page of 25 rows; the cost was a landmine.
            ->with('user')
            ->orderBy('id')
            ->cursorPaginate(25);

        return ApiResponse::success(
            TripEventResource::collection($paginator->getCollection()),
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }
}
