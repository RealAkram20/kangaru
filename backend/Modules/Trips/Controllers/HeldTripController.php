<?php

namespace Modules\Trips\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Trips\Models\Trip;
use Modules\Trips\Repositories\HeldTripRepository;
use Modules\Trips\Requests\HeldTripIndexRequest;
use Modules\Trips\Resources\HeldTripResource;

/**
 * The distance review queue (ADR-0045 §2).
 *
 * Every trip whose distance is holding money up, oldest first, with the
 * figures a reviewer needs to decide and nothing else. The one act performed
 * on a row is `TripDistanceController::clear`, and the evidence behind it is
 * `TripDistanceController::index` — this endpoint is only the worklist.
 *
 * `viewAny` on Trip, not the finance permission: a reviewer needs to *see*
 * the queue before they can be the person who clears it, and an operations
 * user watching the backlog grow is exactly who should be asking finance to
 * work it. Clearing is still `TripPolicy::clearDistance`.
 */
class HeldTripController extends Controller
{
    public function __construct(private readonly HeldTripRepository $held) {}

    public function index(HeldTripIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', Trip::class);

        /** @var User $user */
        $user = $request->user();

        $paginator = $this->held->query($user)->cursorPaginate(25);

        return ApiResponse::success(
            HeldTripResource::collection($paginator->getCollection()),
            $paginator->isEmpty()
                ? 'No trips are waiting on a distance review.'
                : 'Trips waiting on a distance review.',
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // The whole backlog, not the page. A reviewer opening this
                // screen needs to know whether they are looking at all of it.
                'total' => $this->held->count($user),
            ],
        );
    }
}
