<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Modules\Administration\Resources\UserResource;
use Modules\Administration\Services\SettingsService;
use Modules\Administration\Services\SocialSignInService;
use Modules\Administration\Services\SocialTokenException;
use Modules\Administration\Services\SocialTokenVerifier;

/**
 * "Continue with Google / Facebook" (ADR-0028 §3).
 *
 * The phone hands over the provider's proof; everything that matters —
 * verification, audience, who this identity is here — happens server-side
 * against the credentials the admin stored. Turned on and off per provider
 * from the settings screen, and off is a 409 the app also knows not to
 * offer.
 */
class SocialAuthController extends Controller
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly SocialTokenVerifier $verifier,
        private readonly SocialSignInService $signIn,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'provider' => ['required', Rule::in(['google', 'facebook'])],
            'token' => ['required', 'string', 'max:8192'],
            // ADR-0022: this endpoint serves the Driver App only, and the
            // field is required so a future second client cannot inherit the
            // driver scope by omission.
            'client' => ['required', Rule::in(['driver'])],
        ]);

        $provider = $validated['provider'];

        if (! $this->enabled($provider)) {
            return ApiResponse::error(
                ErrorCode::AUTH_METHOD_DISABLED,
                ucfirst($provider).' sign-in is not enabled on this platform.',
                [],
                409,
            );
        }

        try {
            $claims = $this->verifier->verify($provider, $validated['token']);
        } catch (SocialTokenException $e) {
            // The reason stays in the log: which check a forged token failed
            // is tuning information for the forger.
            Log::info('social.token_rejected', ['provider' => $provider, 'reason' => $e->reason]);

            return ApiResponse::error(ErrorCode::SOCIAL_TOKEN_INVALID, $e->getMessage(), [], 401);
        }

        $result = $this->signIn->resolve($provider, $claims);

        return match ($result['kind']) {
            'signed_in' => ApiResponse::success([
                'status' => 'signed_in',
                'user' => new UserResource($result['user']),
                'token' => $result['token'],
            ], 'Logged in successfully.'),

            // 202: understood, accepted, and the thing asked for has not
            // happened — the same shape the MFA challenge uses. The two
            // fields are all the application form can trust pre-filled.
            'sign_up' => ApiResponse::success([
                'status' => 'sign_up',
                'name' => $result['name'],
                'email' => $result['email'],
            ], 'No driver account yet — apply and the office will review it.', 202),

            'mfa_required' => ApiResponse::error(
                ErrorCode::MFA_REQUIRED,
                'This account uses a second factor. Sign in with your email and password instead.',
                [],
                409,
            ),

            default => ApiResponse::error(
                ErrorCode::NOT_A_DRIVER,
                'This sign-in is for drivers. Staff accounts use the console with email and password.',
                [],
                403,
            ),
        };
    }

    private function enabled(string $provider): bool
    {
        if ($provider === 'google') {
            return $this->settings->get('auth', 'google_enabled') === true
                && ! blank($this->settings->get('auth', 'google_client_ids'));
        }

        return $this->settings->get('auth', 'facebook_enabled') === true
            && ! blank($this->settings->get('auth', 'facebook_app_id'))
            && $this->settings->secret('auth', 'facebook_app_secret') !== null;
    }
}
