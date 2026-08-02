<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Modules\Administration\Requests\ChangePasswordRequest;
use Modules\Administration\Requests\LoginRequest;
use Modules\Administration\Resources\UserResource;
use Modules\Administration\Services\AuthService;
use Modules\Administration\Services\InvalidCredentialsException;

class AuthController extends Controller
{
    public function __construct(private readonly AuthService $authService) {}

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

        return ApiResponse::success([
            'user' => new UserResource($result['user']),
            'token' => $result['token'],
        ], 'Logged in successfully.');
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
        return ApiResponse::success(new UserResource($request->user()));
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
