<?php

namespace Modules\Administration\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
}
