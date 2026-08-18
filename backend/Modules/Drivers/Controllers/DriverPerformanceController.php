<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverPerformanceService;

/**
 * How a driver is doing — the six dials and the weekly card.
 *
 * Under `/me` like stats, profile and earnings beside it, and for the reason
 * `DriverStatsController` gives: the driver is the token, so there is no id in
 * the path and no policy question left. Every figure here is about the caller.
 *
 * Separate from `me/stats` rather than a fatter payload on it. That endpoint
 * is polled every sixty seconds by the home screen; this one walks a roster,
 * sums duty sessions and counts a week of trips, and is opened deliberately by
 * somebody who wants to look. The 30-day rates the two share come from one
 * method (`DriverStatsService::qualityFor()`), so they cannot disagree.
 */
class DriverPerformanceController extends Controller
{
    public function __construct(private readonly DriverPerformanceService $performance) {}

    public function show(Request $request): JsonResponse
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

        return ApiResponse::success($this->performance->forDriver($driver), 'Driver performance retrieved.');
    }
}
