<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverStatsService;

/**
 * The driver's own numbers, for their home screen.
 *
 * Under `/me` like the offers and duty endpoints, and for the same reason
 * (`DriverOfferController`): the driver is the token. There is no id in the
 * path and no policy question left — a driver can only ever be asking about
 * themselves, and somebody with no driver profile is not asking a question
 * this endpoint can answer.
 */
class DriverStatsController extends Controller
{
    public function __construct(private readonly DriverStatsService $stats) {}

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

        return ApiResponse::success($this->stats->forDriver($driver), 'Driver statistics retrieved.');
    }
}
