<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverPayoutAccount;
use Modules\Drivers\Resources\OfficePayoutAccountResource;

/**
 * The office reading a driver's payout destination (ADR-0042 §4).
 *
 * **This exists because the loop is not closed without it.** `master-plan.md`
 * §2's completeness gate asks whether the office can see and answer the thing
 * the actor did; a payout destination the office cannot read is a form a driver
 * filled in for nobody. The completeness census found four features in exactly
 * that state and this one was not going to be the fifth.
 *
 * **It returns the whole account number**, which is the point — a clerk cannot
 * wire money to a mask — and is why this is a separate controller and a
 * separate resource from the driver's own.
 *
 * Gated on `drivers.manage`, the permission that already governs a driver's
 * record. **Noted as a refinement, exactly as ADR-0032 §5 noted it for
 * settlement confirmation:** reading somebody's bank account is arguably a
 * Finance act, and when that role separates from Fleet this and
 * `DriverSettlementRequestPolicy` are the same seam.
 */
class PayoutAccountController extends Controller
{
    public function show(Driver $driver): JsonResponse
    {
        $this->authorize('viewPayoutAccount', $driver);

        $account = DriverPayoutAccount::query()->where('driver_id', $driver->getKey())->first();

        if ($account === null) {
            // A distinct code, not a bare 404 on the route. The office needs to
            // tell "this driver has not given us details" apart from "no such
            // driver" — the first is a phone call to the driver, the second is
            // a bug.
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'This driver has not given the office any payout details.',
                [],
                404,
            );
        }

        return ApiResponse::success(
            ['payout_account' => new OfficePayoutAccountResource($account)],
            'Payout account retrieved.',
        );
    }
}
