<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use App\Support\Auth\PasswordPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Administration\Services\PasswordResetService;

/**
 * Forgot-password by emailed code (ADR-0028 §2). Unauthenticated of
 * necessity — the caller's whole problem is that they cannot authenticate.
 *
 * Both endpoints refuse with AUTH_METHOD_DISABLED while the owner has the
 * method off or mail unconfigured, which is also what the app reads before
 * showing the flow — the 409 is the backstop for a stale client, not the
 * normal path.
 */
class PasswordResetController extends Controller
{
    public function __construct(private readonly PasswordResetService $resets) {}

    /**
     * Asks for a code. **Answers an identical 202 whether or not the email
     * belongs to anybody** — same oracle-refusal as ADR-0027 §5, same
     * population being protected.
     */
    public function forgot(Request $request): JsonResponse
    {
        if (! $this->resets->enabled()) {
            return $this->disabled();
        }

        $validated = $request->validate(['email' => ['required', 'email', 'max:190']]);

        $this->resets->request($validated['email']);

        return ApiResponse::success(
            null,
            'If that email belongs to an account, a reset code is on its way. It expires in '
            .PasswordResetService::CODE_TTL_MINUTES.' minutes.',
            202,
        );
    }

    /**
     * Exchanges the code for a new password. A wrong code and an unknown
     * email fail with the same sentence, for the same reason the 202 above
     * is identical.
     */
    public function reset(Request $request): JsonResponse
    {
        if (! $this->resets->enabled()) {
            return $this->disabled();
        }

        $validated = $request->validate([
            'email' => ['required', 'email', 'max:190'],
            'code' => ['required', 'string', 'size:6'],
            // The same floor as ChangePasswordRequest, and it has to be: a
            // reset that set a shorter password than a change could would be
            // the weakest door in.
            'password' => ['required', 'string', 'confirmed', PasswordPolicy::rule()],
        ]);

        $done = $this->resets->reset(
            $validated['email'],
            $validated['code'],
            $validated['password'],
        );

        if (! $done) {
            return ApiResponse::error(
                ErrorCode::VALIDATION_FAILED,
                'That code did not match, or it has expired. Ask for a new one and try again.',
                ['code' => ['That code did not match, or it has expired.']],
                422,
            );
        }

        return ApiResponse::success(
            null,
            'Your password has been changed, and every signed-in session is closed. Sign in with the new password.',
        );
    }

    private function disabled(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::AUTH_METHOD_DISABLED,
            'Password reset is not enabled on this platform. Your fleet office can issue you a new password.',
            [],
            409,
        );
    }
}
