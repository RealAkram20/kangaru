<?php

namespace Modules\Vehicles\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Vehicles\Models\Vehicle;
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
}
