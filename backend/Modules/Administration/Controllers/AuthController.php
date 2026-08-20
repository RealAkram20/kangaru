<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use App\Support\Auth\ClientScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Modules\Administration\Requests\ChangePasswordRequest;
use Modules\Administration\Requests\ConfirmMfaEnrolmentRequest;
use Modules\Administration\Requests\DisableMfaRequest;
use Modules\Administration\Requests\LoginRequest;
use Modules\Administration\Requests\VerifyMfaRequest;
use Modules\Administration\Resources\UserResource;
use Modules\Administration\Services\AuthService;
use Modules\Administration\Services\InvalidCredentialsException;
use Modules\Administration\Services\InvalidMfaChallengeException;
use Modules\Administration\Services\InvalidMfaCodeException;
use Modules\Administration\Services\MfaAlreadyEnrolledException;
use Modules\Administration\Services\MfaService;

class AuthController extends Controller
{
    public function __construct(
        private readonly AuthService $authService,
        private readonly MfaService $mfa,
    ) {}

    public function login(LoginRequest $request): JsonResponse
    {
        try {
            $result = $this->authService->login($request);
        } catch (InvalidCredentialsException) {
            return ApiResponse::error(
                ErrorCode::INVALID_CREDENTIALS,
                'The email or password you entered is incorrect.',
                [],
                401,
            );
        }

        // ADR-0008 decision 2. No token, no abilities, nothing that
        // authenticates a request — a `challenge_id` and a 202 saying the
        // login is accepted but not finished.
        //
        // 202 rather than 200: the request was understood and accepted, and
        // the thing it asked for has not happened yet. A 200 carrying no
        // token would be a success response to an incomplete login, which
        // is exactly the ambiguity a client would get wrong.
        if ($result['challenge'] !== null) {
            return ApiResponse::success(
                [
                    'challenge_id' => $result['challenge'],
                    // Named so the client can label the prompt without
                    // holding its own copy of which roles need a factor.
                    'method' => 'totp',
                ],
                'Enter the code from your authenticator app to finish signing in.',
                202,
            );
        }

        return ApiResponse::success([
            'user' => new UserResource($result['user']->load('tenant')),
            'token' => $result['token'],
            // The SPA needs this at the moment it stores the token: a user
            // in this state can reach nothing but enrolment, and a client
            // that routed them to a dashboard would render a wall of 403s.
            'must_enrol_mfa' => $result['user']->mustEnrolInMfa(),
        ], 'Logged in successfully.');
    }

    /**
     * The second step of a two-step login: a challenge and a code, for a
     * token (ADR-0008 decision 2).
     *
     * Throttled per IP by the route, and bounded per account by the
     * challenge itself — one attempt per challenge, because a challenge
     * that survived a wrong code would turn its five-minute window into an
     * unlimited guessing budget against six digits.
     */
    public function verifyMfa(VerifyMfaRequest $request): JsonResponse
    {
        try {
            $result = $this->authService->verifyMfa(
                $request->validated('challenge_id'),
                $request->validated('code'),
                $request->validated('client') ?? ClientScope::CONSOLE,
            );
        } catch (InvalidMfaChallengeException $e) {
            return ApiResponse::error(ErrorCode::MFA_CHALLENGE_INVALID, $e->getMessage(), [], 401);
        } catch (InvalidMfaCodeException $e) {
            return ApiResponse::error(ErrorCode::MFA_CODE_INVALID, $e->getMessage(), [], 401);
        } catch (InvalidCredentialsException) {
            // The account was suspended between the password and the code.
            return ApiResponse::error(
                ErrorCode::INVALID_CREDENTIALS,
                'The email or password you entered is incorrect.',
                [],
                401,
            );
        }

        return ApiResponse::success([
            'user' => new UserResource($result['user']->load('tenant')),
            'token' => $result['token'],
            'must_enrol_mfa' => false,
        ], 'Logged in successfully.');
    }

    /**
     * Starts enrolment: a secret, a QR to scan, and the URI behind it for
     * anyone typing it in by hand.
     */
    public function beginMfaEnrolment(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        try {
            return ApiResponse::success($this->mfa->beginEnrolment($user));
        } catch (MfaAlreadyEnrolledException $e) {
            // Refused rather than silently re-issuing. Replacing a
            // confirmed secret is a reset, and resetting somebody's second
            // factor is the same hazard as resetting their password.
            return ApiResponse::error(ErrorCode::MFA_ALREADY_ENROLLED, $e->getMessage(), [], 409);
        }
    }

    /**
     * Finishes enrolment and returns the recovery codes.
     *
     * **The only time the codes are ever legible.** They are hashed on the
     * way in, so there is no endpoint that can show them again — which is
     * the point, and is why the response says so.
     */
    public function confirmMfaEnrolment(ConfirmMfaEnrolmentRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        try {
            $codes = $this->mfa->confirmEnrolment($user, $request->validated('code'));
        } catch (InvalidMfaCodeException $e) {
            return ApiResponse::error(ErrorCode::MFA_CODE_INVALID, $e->getMessage(), [], 422);
        }

        return ApiResponse::success(
            ['recovery_codes' => $codes],
            'Two-factor authentication is on. Save these recovery codes somewhere safe — they are shown once and cannot be retrieved.',
        );
    }

    /**
     * Issues a fresh set of recovery codes, invalidating the old ones.
     *
     * Self-service and only for your own account. Per ADR-0008 the holder
     * regenerates; nobody resets anybody else's, for the same reason no
     * administrator can change another user's password here.
     */
    public function regenerateRecoveryCodes(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        if (! $user->hasMfaEnabled()) {
            return ApiResponse::error(
                ErrorCode::MFA_ENROLMENT_REQUIRED,
                'Set up two-factor authentication before generating recovery codes.',
                [],
                403,
            );
        }

        return ApiResponse::success(
            ['recovery_codes' => $this->mfa->generateRecoveryCodes($user)],
            'New recovery codes generated. The previous set no longer works.',
        );
    }

    /**
     * Removes your own second factor (ADR-0010 decision 2).
     *
     * Only for a role that does not require one. Without this, honouring a
     * voluntary enrolment would set a trap: a user could switch a factor on
     * and then neither switch it off nor find an administrator able to,
     * because ADR-0008 builds no reset on purpose. An opt-in the person who
     * opted in cannot reverse is not voluntary.
     *
     * A `403` for a privileged role rather than a `422`: the request is
     * perfectly well-formed, the account simply may not do this.
     */
    public function disableMfa(DisableMfaRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        if ($user->requiresMfa()) {
            return ApiResponse::error(
                ErrorCode::FORBIDDEN,
                'Your role requires two-factor authentication, so it cannot be turned off. '
                .'Ask a Super Admin to change the role if this is wrong.',
                [],
                403,
            );
        }

        try {
            $this->mfa->disable($user, $request->validated('code'));
        } catch (InvalidMfaCodeException $e) {
            return ApiResponse::error(ErrorCode::MFA_CODE_INVALID, $e->getMessage(), [], 422);
        }

        return ApiResponse::success(
            new UserResource($user->fresh()->load('tenant')),
            'Two-factor authentication is off. You can turn it back on at any time.',
        );
    }

    public function logout(Request $request): JsonResponse
    {
        // Guaranteed non-null: this route requires auth:sanctum.
        /** @var User $user */
        $user = $request->user();

        $this->authService->logout($user);

        return ApiResponse::success(message: 'Logged out successfully.');
    }

    public function me(Request $request): JsonResponse
    {
        return ApiResponse::success(new UserResource($request->user()->load('tenant')));
    }

    /**
     * Changes your own password, and only your own — there is no user
     * parameter for an administrator to supply.
     *
     * An admin silently resetting someone else's password is the one act an
     * audit trail cannot tell apart from impersonation, so this module does
     * not offer it (see the README's deferred list).
     *
     * Every token is revoked afterwards, this one included. A password
     * change is usually a response to "I think someone else has this", and
     * leaving any session signed in would defeat the point — so the caller
     * signs back in with the password they just chose.
     */
    public function changePassword(ChangePasswordRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        if (! Hash::check($request->validated('current_password'), $user->password)) {
            return ApiResponse::error(
                ErrorCode::INVALID_CREDENTIALS,
                'Your current password is incorrect.',
                ['current_password' => ['Your current password is incorrect.']],
                422,
            );
        }

        $this->authService->changePassword($user, $request->validated('password'));

        return ApiResponse::success(
            message: 'Password changed. You have been signed out everywhere — please sign in again with your new password.',
        );
    }
}
