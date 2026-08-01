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
            ->with('user:id,tenant_id,name,email,role,created_at')
            ->orderBy('id')
            ->cursorPaginate(25);

        return ApiResponse::success(
            TripEventResource::collection($paginator->getCollection()),
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }
}
