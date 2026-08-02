<?php

namespace Modules\Trips\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Trips\Models\Trip;
use Modules\Trips\Resources\TripEventResource;

class TripEventController extends Controller
{
    public function index(Trip $trip): JsonResponse
    {
        $this->authorize('view', $trip);

        $paginator = $trip->events()
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
