<?php

namespace Modules\Administration\Services;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Modules\Administration\Requests\LoginRequest;

class AuthService
{
    /**
     * Locates the user unscoped by tenant — login must find a user by email
     * before any tenant is known (User is deliberately not BelongsToTenant).
     *
     * @return array{user: User, token: string}
     */
    public function login(LoginRequest $request): array
    {
        $user = User::where('email', $request->validated('email'))->first();

        if (! $user || ! Hash::check($request->validated('password'), $user->password)) {
            throw new InvalidCredentialsException;
        }

        $token = $user->createToken('api')->plainTextToken;

        return ['user' => $user, 'token' => $token];
    }

    public function logout(User $user): void
    {
        $user->currentAccessToken()->delete();
    }
}
