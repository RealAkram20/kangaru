<?php

namespace Modules\Vehicles\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Fleet\Services\PlanAllowance;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Requests\BulkDeleteVehiclesRequest;
use Modules\Vehicles\Requests\StoreVehicleRequest;
use Modules\Vehicles\Requests\UpdateVehicleRequest;
use Modules\Vehicles\Resources\VehicleResource;
use Modules\Vehicles\Services\VehicleService;

class VehicleController extends Controller
{
    public function __construct(private readonly VehicleService $vehicles) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Vehicle::class);

        /** @var User $user */
        $user = $request->user();

        return ApiResponse::success(VehicleResource::collection($this->vehicles->list($user)));
    }

    public function show(Vehicle $vehicle): JsonResponse
    {
        $this->authorize('view', $vehicle);

        return ApiResponse::success(new VehicleResource($vehicle));
    }

    public function store(StoreVehicleRequest $request): JsonResponse
    {
        $this->authorize('create', Vehicle::class);

        /** @var User $actor */
        $actor = $request->user();

        // ADR-0058 §4. The limit is checked **here, at the point of adding**,
        // and nowhere else — a vehicle who cannot work because of their
        // employer's billing is a support call that takes an hour to diagnose
        // and reaches the wrong team twice on the way. Exceeding a limit never
        // touches what already exists.
        //
        // Head office has no fleet of its own, so there is nothing to charge
        // and nothing to check.
        if ($actor->operator_id !== null && $actor->operator !== null) {
            app(PlanAllowance::class)->require($actor->operator, PlanAllowance::VEHICLES);
        }

        $vehicle = $this->vehicles->create($request);

        return ApiResponse::success(new VehicleResource($vehicle), 'Vehicle created.', 201);
    }

    public function update(UpdateVehicleRequest $request, Vehicle $vehicle): JsonResponse
    {
        $this->authorize('update', $vehicle);

        $vehicle = $this->vehicles->update($vehicle, $request);

        return ApiResponse::success(new VehicleResource($vehicle), 'Vehicle updated.');
    }

    public function destroy(Vehicle $vehicle): JsonResponse
    {
        $this->authorize('delete', $vehicle);

        $this->vehicles->delete($vehicle);

        return ApiResponse::success(message: 'Vehicle deleted.', status: 204);
    }

    /**
     * Retire several vehicles in one action, or none of them.
     *
     * Authorised **once, against the class**, and then scoped by the service:
     * `authorize('deleteAny')` answers "may this user delete vehicles at all",
     * and `deleteMany` answers "which of these are theirs" by building the
     * batch from `Vehicle::forActor()`. Calling `authorize('delete', ...)` per
     * vehicle would need the models loaded first, and loading them by raw id
     * before the scope is the shape of the leak ADR-0055 §3 closed.
     *
     * **200, not 204.** The single delete above returns no content because
     * there is nothing to say; this one always has something — which vehicles
     * went, or which refused and why. A 204 here would make the refusal path
     * indistinguishable from success at the transport level, and the screen
     * would have to guess.
     */
    public function bulkDestroy(BulkDeleteVehiclesRequest $request): JsonResponse
    {
        $this->authorize('deleteAny', Vehicle::class);

        /** @var User $user */
        $user = $request->user();

        $result = $this->vehicles->deleteMany($user, $request->ids());

        if ($result['refused'] !== []) {
            /*
             * **Grouped by reason, not listed per vehicle**, and the grouping
             * is the whole point. The envelope carries `errors` as a map of
             * string lists (`EmptyableStringListMap`), which is normally
             * field-to-messages; here it is reason-to-vehicles, which is the
             * same shape used the same way. A generic error renderer shows
             * something sensible either way.
             *
             * The first version emitted one line per vehicle, each ending in
             * the same sentence. Five vehicles out on a job produced the same
             * twelve words five times, and a hundred — the ceiling this
             * endpoint accepts — would have produced a dialog nobody reads.
             * Rendering it proved that; it is not visible in a test.
             *
             * The reason stays server-side copy, so the console never has to
             * carry a dictionary of codes that can drift from this list. Each
             * vehicle appears as its registration, or as its id where this
             * user may not be told the registration — an id that is not on
             * their fleet has no plate they are allowed to read.
             */
            $grouped = [];

            foreach ($result['refused'] as $refusal) {
                $grouped[$refusal['reason']][] = $refusal['registration_number'] ?? '#'.$refusal['id'];
            }

            return ApiResponse::error(
                ErrorCode::VALIDATION_FAILED,
                'Nothing was deleted. Some of the vehicles you chose cannot be.',
                $grouped,
                422,
            );
        }

        return ApiResponse::success(
            ['deleted' => $result['deleted']],
            message: count($result['deleted']) === 1
                ? 'Vehicle deleted.'
                : count($result['deleted']).' vehicles deleted.',
        );
    }
}
