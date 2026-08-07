<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Requests\StoreDriverAccountRequest;
use Modules\Drivers\Resources\DriverResource;
use Modules\Drivers\Services\DriverAccountConflictException;
use Modules\Drivers\Services\DriverAccountService;

/**
 * The account a driver signs in with — its own sub-resource (ADR-0016).
 *
 * A sub-resource rather than a field on the driver, because attaching a
 * login is a different act under a different permission from editing a
 * phone number, and because `DELETE` on it says "take the login away"
 * without any ambiguity about whether the profile went with it.
 */
class DriverAccountController extends Controller
{
    public function __construct(private readonly DriverAccountService $accounts) {}

    public function store(StoreDriverAccountRequest $request, Driver $driver): JsonResponse
    {
        $this->authorize('manageAccount', $driver);

        try {
            $this->accounts->open($driver, $request->validated());
        } catch (DriverAccountConflictException $e) {
            return ApiResponse::error(ErrorCode::DRIVER_ACCOUNT_CONFLICT, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            new DriverResource($driver->refresh()->load('user')),
            'The driver can now sign in.',
            201,
        );
    }

    /**
     * Idempotent on purpose: removing a login a driver does not have is
     * already the state the caller asked for, and answering 404 would make
     * a retry after a dropped response look like a different failure.
     */
    public function destroy(Driver $driver): JsonResponse
    {
        $this->authorize('manageAccount', $driver);

        $this->accounts->close($driver);

        return ApiResponse::success(
            new DriverResource($driver->refresh()->load('user')),
            'The driver can no longer sign in, and any session they had is closed.',
        );
    }
}
