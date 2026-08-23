<?php

namespace Modules\Clients\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Clients\Models\ClientRoute;
use Modules\Clients\Requests\StoreClientRouteRequest;
use Modules\Clients\Requests\UpdateClientRouteRequest;
use Modules\Clients\Resources\ClientRouteResource;
use Modules\Clients\Services\ClientRouteReferenceException;
use Modules\Clients\Services\ClientRouteService;

/**
 * The circuits a client builds (ADR-0045 §1).
 *
 * Reads run through `forActor()`, so a platform dispatcher holding
 * `routes.view` sees every client's routes and a client sees only their
 * own. Writes are refused to platform staff by the policy — see
 * `ClientRoutePolicy` for both halves of why.
 */
class ClientRouteController extends Controller
{
    public function __construct(private readonly ClientRouteService $routes) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', ClientRoute::class);

        /** @var User $user */
        $user = $request->user();

        // `stops.place` eager-loaded rather than lazily reached: the list
        // screen draws every route's line on one map, so N routes would
        // otherwise be 2N queries — and the count on each card needs the
        // relation anyway.
        $routes = ClientRoute::query()
            ->forActor($user)
            ->with(['stops.place', 'members'])
            ->orderBy('name')
            ->get();

        return ApiResponse::success(ClientRouteResource::collection($routes));
    }

    public function show(ClientRoute $route): JsonResponse
    {
        $this->authorize('view', $route);

        return ApiResponse::success(
            new ClientRouteResource($route->load(['stops.place', 'members'])),
        );
    }

    public function store(StoreClientRouteRequest $request): JsonResponse
    {
        $this->authorize('create', ClientRoute::class);

        /** @var User $user */
        $user = $request->user();

        try {
            $route = $this->routes->create($request->validated(), $user);
        } catch (ClientRouteReferenceException $e) {
            return $this->refuseReference($e);
        }

        return ApiResponse::success(new ClientRouteResource($route), 'Route saved.', 201);
    }

    public function update(UpdateClientRouteRequest $request, ClientRoute $route): JsonResponse
    {
        $this->authorize('update', $route);

        try {
            $route = $this->routes->update($route, $request->validated());
        } catch (ClientRouteReferenceException $e) {
            return $this->refuseReference($e);
        }

        return ApiResponse::success(new ClientRouteResource($route), 'Route updated.');
    }

    public function destroy(ClientRoute $route): JsonResponse
    {
        $this->authorize('delete', $route);

        // Soft delete. The trips this route produced are still on the books
        // and still name it in their history; a hard delete would leave
        // those records pointing at nothing. Retiring without deleting is
        // `is_active`, which is what the screen offers first.
        $route->delete();

        return ApiResponse::success(message: 'Route deleted.', status: 204);
    }

    /**
     * One place to turn "that id is not yours" into a 422 the builder can
     * act on, rather than two identical catch blocks drifting apart.
     */
    private function refuseReference(ClientRouteReferenceException $e): JsonResponse
    {
        return ApiResponse::error($e->errorCode, $e->getMessage(), $e->errors());
    }
}
