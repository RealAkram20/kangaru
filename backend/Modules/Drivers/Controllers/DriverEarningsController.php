<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Drivers\Enums\EarningsPeriod;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Requests\DriverEarningsRequest;
use Modules\Drivers\Services\DriverEarningsService;

/**
 * What this driver earned, over a day, a week or a month.
 *
 * Under `/me` like `me/stats`, `me/duty` and the offer endpoints, and for the
 * same reason `DriverStatsController` gives: **the driver is the token.**
 * There is no id in the path and no policy question left — a driver can only
 * ever ask about themselves, so there is no cross-driver read to authorise and
 * no way to spell one.
 *
 * That is worth stating rather than assuming, because this is the first
 * endpoint on the platform that serves a driver's earnings *history*. The
 * per-trip figure on `TripResource` is gated on `driver->user_id`; this needs
 * no such gate only because the subject is derived from the token instead of
 * from a parameter. If a `drivers/{driver}/earnings` variant is ever added for
 * the office, it needs a policy — this one does not, and the difference is
 * exactly that path parameter.
 */
class DriverEarningsController extends Controller
{
    public function __construct(private readonly DriverEarningsService $earnings) {}

    public function show(DriverEarningsRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $driver = Driver::query()->where('user_id', $user->id)->first();

        if ($driver === null) {
            return ApiResponse::error(
                ErrorCode::NOT_A_DRIVER,
                'This account is not linked to a driver profile.',
                [],
                403,
            );
        }

        $period = EarningsPeriod::from($request->validated('period') ?? EarningsPeriod::DAY->value);

        return ApiResponse::success(
            $this->earnings->forDriver($driver, $period),
            'Driver earnings retrieved.',
        );
    }
}
