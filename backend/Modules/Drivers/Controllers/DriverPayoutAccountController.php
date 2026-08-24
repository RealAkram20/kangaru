<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverPayoutAccount;
use Modules\Drivers\Requests\StorePayoutAccountRequest;
use Modules\Drivers\Resources\DriverPayoutAccountResource;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Notifications\SecurityEventNotification;

/**
 * The driver's own payout destination (ADR-0042).
 *
 * Under `/me` like `me/profile` and `me/photo`, for the reason those give:
 * **the driver is the token.** No id in the path, so no policy question and no
 * way to spell a cross-driver read or write.
 *
 * Singular, because a driver has one destination or none — the same shape
 * ADR-0016 chose for `drivers/{driver}/account`. `PUT` attaches or replaces;
 * `DELETE` takes it away.
 *
 * **Nothing here moves money.** ADR-0029 §6's boundary is unchanged and
 * ADR-0032's request-and-confirm flow is still the only thing that writes a
 * ledger entry.
 */
class DriverPayoutAccountController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $account = DriverPayoutAccount::query()->where('driver_id', $driver->getKey())->first();

        // Null rather than a 404. "You have not told us where to send your
        // money" is a normal state for a new driver and the screen renders it
        // as an empty form; a 404 would make the app treat an ordinary first
        // visit as an error.
        return ApiResponse::success(
            ['payout_account' => $account === null ? null : new DriverPayoutAccountResource($account)],
            'Payout account retrieved.',
        );
    }

    /**
     * Sets or replaces it.
     *
     * `updateOrCreate` on `driver_id`, which is what makes this idempotent: a
     * driver on a bad connection who taps Save twice gets one destination, not
     * a unique-constraint 500 on the second.
     */
    public function update(StorePayoutAccountRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $existed = DriverPayoutAccount::query()->where('driver_id', $driver->getKey())->exists();

        $account = DriverPayoutAccount::updateOrCreate(
            ['driver_id' => $driver->getKey()],
            $request->validated(),
        );

        /*
         * Where this driver's money goes just moved, so the driver hears about
         * it (mail plan D15).
         *
         * Only on a change, never on first setup: telling somebody "your
         * payout account changed" seconds after they created one is the
         * notification fatigue AGENTS.md warns about, and it teaches them to
         * ignore the message on the day it is not them.
         *
         * **The account number is not in the email.** Neither the old one nor
         * the new one, not even masked. This message exists for the case where
         * an attacker is reading the mailbox, and an email that quotes the
         * detail it is warning about hands that detail straight to them.
         */
        if ($existed) {
            /*
             * The driver's own account, resolved through `$driver`, not
             * `$request->user()`.
             *
             * `$request->user()` is typed `Customer|User` across this
             * application's two guards, and `Customer` has no `notify()`.
             * Larastan caught it; at runtime it would have been a fatal on the
             * one path where a customer somehow reached here. Going through
             * the driver is also simply more correct: the warning belongs to
             * whoever owns the payout account, which is the driver, not
             * whoever happens to be holding the request.
             */
            $driver->user?->notify(new SecurityEventNotification(
                NotificationType::DRIVER_PAYOUT_ACCOUNT_CHANGED,
                [__('mail.security.fact_when') => now()->isoFormat('D MMMM YYYY, HH:mm')],
            ));
        }

        return ApiResponse::success(
            ['payout_account' => new DriverPayoutAccountResource($account)],
            'Payout details saved. The office pays into this account.',
        );
    }

    /**
     * Removes it.
     *
     * Answers the same shape whether or not one was held, so a driver who taps
     * twice does not get an error for the second tap.
     */
    public function destroy(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        DriverPayoutAccount::query()->where('driver_id', $driver->getKey())->delete();

        return ApiResponse::success(
            ['payout_account' => null],
            'Payout details removed. Ask the office how you will be paid.',
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
