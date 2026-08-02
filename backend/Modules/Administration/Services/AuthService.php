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

        // A suspended account is refused with the *same* exception and the
        // same message as a wrong password, deliberately.
        //
        // Saying "this account is suspended" tells an attacker that the
        // address is real and that they guessed the password — the two
        // facts a credential-stuffing run is trying to learn. Suspension is
        // an internal state; the person it affects finds out from their
        // administrator, not from the login form.
        //
        // Checked after the hash, so the response time does not distinguish
        // a suspended account from an active one either.
        if (! $user->status->canSignIn()) {
            throw new InvalidCredentialsException;
        }

        $token = $user->createToken('api')->plainTextToken;

        return ['user' => $user, 'token' => $token];
    }

    public function logout(User $user): void
    {
        $user->currentAccessToken()->delete();
    }

    /**
     * Sets a new password and signs every device out, including this one.
     *
     * A password change usually follows "I think somebody else has this",
     * so leaving old sessions alive would defeat it.
     *
     * Keeping the *current* token alive would be friendlier, and was the
     * first attempt — but identifying it means calling
     * `currentAccessToken()`, which Sanctum types as non-nullable while
     * returning a `TransientToken` with no key under some guards. The
     * choice was a fragile exception or a blunt rule, and for a credential
     * change the blunt rule is also the safer one: everything goes, and the
     * new password is used immediately to sign back in. The endpoint says
     * so in its response.
     *
     * `password` is a hashed cast on the model, so the plaintext is never
     * what gets stored.
     */
    public function changePassword(User $user, string $password): void
    {
        $user->password = $password;
        $user->save();

        $user->tokens()->delete();
    }
}
