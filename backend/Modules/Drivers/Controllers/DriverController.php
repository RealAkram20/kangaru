<?php

namespace Modules\Drivers\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Requests\StoreDriverRequest;
use Modules\Drivers\Requests\UpdateDriverRequest;
use Modules\Drivers\Resources\DriverResource;
use Modules\Drivers\Services\DriverService;
use Modules\Fleet\Services\PlanAllowance;

class DriverController extends Controller
{
    public function __construct(private readonly DriverService $drivers) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Driver::class);

        /** @var User $user */
        $user = $request->user();

        return ApiResponse::success(DriverResource::collection($this->drivers->list($user)));
    }

    public function show(Driver $driver): JsonResponse
    {
        $this->authorize('view', $driver);

        return ApiResponse::success(new DriverResource($driver));
    }

    public function store(StoreDriverRequest $request): JsonResponse
    {
        $this->authorize('create', Driver::class);

        /** @var User $actor */
        $actor = $request->user();

        // ADR-0058 §4. The limit is checked **here, at the point of adding**,
        // and nowhere else — a driver who cannot work because of their
        // employer's billing is a support call that takes an hour to diagnose
        // and reaches the wrong team twice on the way. Exceeding a limit never
        // touches what already exists.
        //
        // Head office has no fleet of its own, so there is nothing to charge
        // and nothing to check.
        if ($actor->operator_id !== null && $actor->operator !== null) {
            app(PlanAllowance::class)->require($actor->operator, PlanAllowance::DRIVERS);
        }

        $driver = $this->drivers->create($request);

        return ApiResponse::success(new DriverResource($driver), 'Driver created.', 201);
    }

    public function update(UpdateDriverRequest $request, Driver $driver): JsonResponse
    {
        $this->authorize('update', $driver);

        $driver = $this->drivers->update($driver, $request);

        return ApiResponse::success(new DriverResource($driver), 'Driver updated.');
    }

    public function destroy(Driver $driver): JsonResponse
    {
        $this->authorize('delete', $driver);

        $this->drivers->delete($driver);

        return ApiResponse::success(message: 'Driver deleted.', status: 204);
    }
}
