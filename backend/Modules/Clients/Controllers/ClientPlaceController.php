<?php

namespace Modules\Clients\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Clients\Models\ClientPlace;
use Modules\Clients\Requests\StoreClientPlaceRequest;
use Modules\Clients\Requests\UpdateClientPlaceRequest;
use Modules\Clients\Resources\ClientPlaceResource;

/**
 * The client's register of pinned locations (ADR-0045 §1).
 *
 * No service class: this is single-model CRUD with no business logic beyond
 * the delete refusal below, and ADR-0002 is explicit that a repository or
 * service which only proxies `find`/`create`/`update`/`delete` must be
 * deleted in review. Routes are the opposite — stops and members make
 * saving one a transaction — and have `ClientRouteService` accordingly.
 */
class ClientPlaceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', ClientPlace::class);

        /** @var User $user */
        $user = $request->user();

        $places = ClientPlace::query()
            ->forActor($user)
            ->orderBy('name')
            ->get();

        return ApiResponse::success(ClientPlaceResource::collection($places));
    }

    public function show(ClientPlace $place): JsonResponse
    {
        $this->authorize('view', $place);

        return ApiResponse::success(new ClientPlaceResource($place->load('routeStops')));
    }

    public function store(StoreClientPlaceRequest $request): JsonResponse
    {
        $this->authorize('create', ClientPlace::class);

        /** @var User $user */
        $user = $request->user();

        // `tenant_id` is auto-filled by `BelongsToTenant` from the request's
        // TenantContext, which is why the policy refuses platform staff the
        // write half — they have no tenant for it to read.
        $place = ClientPlace::query()->create([
            ...$request->validated(),
            'created_by_user_id' => $user->id,
        ]);

        return ApiResponse::success(new ClientPlaceResource($place), 'Place saved.', 201);
    }

    public function update(UpdateClientPlaceRequest $request, ClientPlace $place): JsonResponse
    {
        $this->authorize('update', $place);

        $place->update($request->validated());

        return ApiResponse::success(new ClientPlaceResource($place), 'Place updated.');
    }

    public function destroy(ClientPlace $place): JsonResponse
    {
        $this->authorize('delete', $place);

        // Asked before the delete rather than caught after it. The foreign
        // key would refuse this anyway (restrictOnDelete), but a constraint
        // violation is a 500 with a driver's error string in it — and the
        // useful answer here names the routes, so the officer knows what to
        // edit instead of what went wrong.
        $routeNames = $place->routeStops()
            ->with('route:id,name')
            ->get()
            ->pluck('route.name')
            ->filter()
            ->unique()
            ->values();

        if ($routeNames->isNotEmpty()) {
            return ApiResponse::error(
                ErrorCode::CLIENT_PLACE_IN_USE,
                'This place is still on '.$routeNames->count().' of your routes ('.$routeNames->join(', ').'). Remove it from those routes first, or switch it off instead of deleting it.',
                ['routes' => $routeNames->all()],
                409,
            );
        }

        $place->delete();

        return ApiResponse::success(message: 'Place deleted.', status: 204);
    }
}
