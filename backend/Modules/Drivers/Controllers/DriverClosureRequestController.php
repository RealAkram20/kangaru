<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Enums\ClosureRequestStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverClosureRequest;
use Modules\Drivers\Requests\StoreClosureRequest;
use Modules\Drivers\Resources\DriverClosureRequestResource;
use Modules\Drivers\Services\ClosureRequestAlreadyDecidedException;
use Modules\Drivers\Services\ClosureRequestAlreadyOpenException;
use Modules\Drivers\Services\DriverClosureService;

/**
 * The driver's own side of closing their account (ADR-0043).
 *
 * Under `/me` like every other driver-owned surface: the driver is the token,
 * so there is no id in the path and no cross-driver act to spell.
 *
 * **Nothing here closes anything.** Asking writes a row; the office's
 * confirmation is what deactivates the account, and the driver finds out by
 * email because by then they cannot sign in to be told any other way.
 */
class DriverClosureRequestController extends Controller
{
    public function __construct(private readonly DriverClosureService $closures) {}

    /**
     * The driver's current request, or null.
     *
     * Returns the **latest** rather than only an open one, so the screen can
     * show a declined answer and its reason. A driver who was refused needs to
     * read why more than they need the row to disappear.
     */
    public function show(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $latest = DriverClosureRequest::query()
            ->where('driver_id', $driver->getKey())
            ->latest('id')
            ->first();

        return ApiResponse::success(
            ['closure_request' => $latest === null ? null : new DriverClosureRequestResource($latest)],
            'Closure request retrieved.',
        );
    }

    public function store(StoreClosureRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        try {
            $created = $this->closures->request($driver, $request->validated()['reason'] ?? null);
        } catch (ClosureRequestAlreadyOpenException $e) {
            return ApiResponse::error(ErrorCode::CLOSURE_REQUEST_ALREADY_OPEN, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            ['closure_request' => new DriverClosureRequestResource($created)],
            'The office has your request. You can still work until they answer.',
        );
    }

    /**
     * The driver changing their mind.
     *
     * `DELETE` on the singular resource rather than a `POST /withdraw`: unlike
     * the office's confirm and decline — decisions with their own audit meaning
     * — this is somebody taking back their own ask, which is what a delete on
     * your own resource means.
     */
    public function destroy(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $open = DriverClosureRequest::query()
            ->where('driver_id', $driver->getKey())
            ->where('status', ClosureRequestStatus::PENDING)
            ->latest('id')
            ->first();

        if ($open === null) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'You have no request waiting to be answered.',
                [],
                404,
            );
        }

        try {
            $withdrawn = $this->closures->withdraw($open);
        } catch (ClosureRequestAlreadyDecidedException $e) {
            return ApiResponse::error(ErrorCode::CLOSURE_REQUEST_ALREADY_DECIDED, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            ['closure_request' => new DriverClosureRequestResource($withdrawn)],
            'Request withdrawn. Your account stays open.',
        );
    }

    private function driverFor(Request $request): ?Driver
    {
        /** @var User $user */
        $user = $request->user();

        return Driver::query()->where('user_id', $user->id)->first();
    }

    private function notADriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_A_DRIVER,
            'This account is not linked to a driver profile.',
            [],
            403,
        );
    }
}
