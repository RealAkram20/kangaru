<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Enums\SettlementRequestKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Drivers\Requests\StoreSettlementRequest;
use Modules\Drivers\Resources\DriverSettlementRequestResource;
use Modules\Drivers\Services\DriverSettlementRequestService;
use Modules\Drivers\Services\SettlementRequestAlreadyOpenException;
use Modules\Trips\Models\Trip;

/**
 * A driver's own settlement requests (ADR-0032).
 *
 * Under `/me` like the rest of the driver surface — the driver is the token,
 * so there is no id in the path and no cross-driver read to authorise.
 *
 * **This is the only write a driver makes about their own money, and it does
 * not move any.** Raising a request records that they say cash changed hands,
 * or that they would like it to. The ledger learns about it when somebody at
 * the office confirms, and not before — see
 * `SettlementRequestController::confirm()`.
 */
class DriverSettlementRequestController extends Controller
{
    public function __construct(private readonly DriverSettlementRequestService $requests) {}

    /**
     * The driver's own requests, newest first.
     *
     * Not paginated, and deliberately: a driver holds at most one open
     * request per kind, and the history behind them is short — settlements
     * happen weekly, not per trip. The wallet screen shows the open ones and
     * the last few answers, which is the whole useful set.
     */
    public function index(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $rows = DriverSettlementRequest::query()
            ->where('driver_id', $driver->getKey())
            ->orderByDesc('id')
            ->limit(20)
            ->get();

        return ApiResponse::success(DriverSettlementRequestResource::collection($rows));
    }

    public function store(StoreSettlementRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $kind = SettlementRequestKind::from((string) $request->validated('kind'));
        $trip = null;

        if ($kind->requiresTrip()) {
            $tripId = (int) $request->validated('trip_id');

            /*
             * **The trip must be this driver's own, and that is checked here
             * rather than in the form request** (ADR-0034 §1).
             *
             * `exists:trips,id` in the validator proves only that the trip is
             * real. Without this, a driver could declare a tip against
             * somebody else's job — and because a confirmed tip writes a
             * credit, that is a driver inserting themselves into another
             * driver's journey for money.
             *
             * `Trip::forDriver()` rather than a plain `where`: `TenantScope`
             * fails closed and a walk-in has no tenant, so the obvious query
             * finds nothing and this would refuse every legitimate tip on the
             * work drivers actually do. Same trap the ledger and history
             * endpoints both document.
             */
            $trip = Trip::forDriver($driver)->whereKey($tripId)->first();

            if ($trip === null) {
                // 404, not 403: AGENTS.md's rule that a refusal must not
                // confirm the existence of a row the caller may not see. A
                // driver probing trip ids learns nothing either way.
                return ApiResponse::error(
                    ErrorCode::NOT_FOUND,
                    'That trip is not one of yours.',
                    [],
                    404,
                );
            }
        }

        try {
            $created = $this->requests->raise(
                $driver,
                $kind,
                (int) $request->validated('amount_minor'),
                $request->validated('note'),
                'UGX',
                $trip,
            );
        } catch (SettlementRequestAlreadyOpenException $e) {
            // 409, not 422: the payload is well formed and the world refuses
            // it. The driver's own screen already shows the open request.
            return ApiResponse::error(
                ErrorCode::SETTLEMENT_REQUEST_ALREADY_OPEN,
                $e->getMessage(),
                [],
                409,
            );
        }

        return ApiResponse::success(
            new DriverSettlementRequestResource($created),
            'Your request has been sent to the office.',
            201,
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
